// Copyright (c) Meta Platforms, Inc. and affiliates.

using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Meta.XR;
using Meta.XR.Samples;
using Unity.Collections;
using Unity.InferenceEngine;
using UnityEngine;

namespace PassthroughCameraSamples.MultiObjectDetection
{
    [MetaCodeSample("PassthroughCameraApiSamples-MultiObjectDetection")]
    public class SentisInferenceRunManager : MonoBehaviour
    {
        [SerializeField] private PassthroughCameraAccess m_cameraAccess;
        [SerializeField] private DetectionUiMenuManager m_uiMenuManager;
        [SerializeField] private DetectionManager m_detectionManager;

        [Header("Sentis Model config")]
        [SerializeField] private BackendType m_backend = BackendType.CPU;
        [SerializeField] private ModelAsset m_sentisModel;
        [SerializeField] private TextAsset m_labelsAsset;
        [SerializeField, Range(0, 1)] private float m_iouThreshold = 0.6f;
        [SerializeField, Range(0, 1)] private float m_scoreThreshold = 0.3f;

        [Header("Distant object assist")]
        [SerializeField, Range(0, 1)] private float m_smallBoxScoreThreshold = 0.08f;
        [SerializeField, Range(0, 0.1f)] private float m_smallBoxMaxAreaRatio = 0.02f;
        [SerializeField] private bool m_useBlueSheetPrior = true;
        [SerializeField, Range(0, 1)] private float m_blueSheetMinRatio = 0.25f;
        [SerializeField, Range(2, 16)] private int m_blueSheetSampleColumns = 6;
        [SerializeField, Range(2, 16)] private int m_blueSheetSampleRows = 4;

        [Header("Blue sheet fallback")]
        [SerializeField] private bool m_useBlueSheetObjectFallback = true;
        [SerializeField, Range(40, 320)] private int m_fallbackSampleWidth = 160;
        [SerializeField, Range(24, 240)] private int m_fallbackSampleHeight = 90;
        [SerializeField, Range(0.0001f, 0.05f)] private float m_fallbackMinBlobAreaRatio = 0.0005f;
        [SerializeField, Range(0.001f, 0.3f)] private float m_fallbackMaxBlobAreaRatio = 0.03f;
        [SerializeField, Range(0, 1)] private float m_fallbackMinGreenRatio = 0.25f;
        [SerializeField, Range(0, 1)] private float m_fallbackMinBlueUnderRatio = 0.35f;
        [SerializeField, Range(0, 1)] private float m_fallbackMinCenterYRatio = 0.35f;
        [SerializeField, Range(1, 8)] private int m_fallbackBlueSearchRadius = 3;
        [SerializeField, Range(1, 2)] private float m_fallbackBoxPadding = 1.35f;

        [Header("Detection diagnostics")]
        [SerializeField] private bool m_logDetectionDiagnostics = true;
        [SerializeField, Min(0.2f)] private float m_diagnosticLogInterval = 1f;

        [Header("UI display references")]
        [SerializeField] private SentisInferenceUiManager m_uiInference;

        [Header("[Editor Only] Convert to Sentis")]
        public ModelAsset OnnxModel;
        [Space(40)]

        private Worker m_engine;
        private Vector2Int m_inputSize;
        private float m_nextDiagnosticLogTime;
        private readonly List<(int classId, Vector4 boundingBox)> m_detections = new List<(int classId, Vector4 boundingBox)>();

        private void Awake()
        {
            var model = ModelLoader.Load(m_sentisModel);
            var inputShape = model.inputs[0].shape;
            m_inputSize = new Vector2Int(inputShape.Get(2), inputShape.Get(3));
            m_engine = new Worker(model, m_backend);
        }

        private IEnumerator Start()
        {
            m_uiInference.SetLabels(m_labelsAsset);

            while (true)
            {
                while (m_uiMenuManager.IsPaused)
                {
                    yield return null;
                }
                yield return RunInference();
            }
        }

        private void OnDestroy()
        {
            m_engine.PeekOutput(0)?.CompleteAllPendingOperations();
            m_engine.PeekOutput(1)?.CompleteAllPendingOperations();
            m_engine.PeekOutput(2)?.CompleteAllPendingOperations();
            m_engine.Dispose();
        }

        internal static void PreloadModel(ModelAsset modelAsset)
        {
            // Load model
            var model = ModelLoader.Load(modelAsset);
            var inputShape = model.inputs[0].shape;

            // Create engine to run model
            using var worker = new Worker(model, BackendType.CPU);

            // Run inference with an empty image to load the model in the memory. The first inference blocks the main thread for a long time, so we're doing it on the app launch
            Texture tempTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            var textureTransform = new TextureTransform().SetDimensions(tempTexture.width, tempTexture.height, 3);
            using var input = new Tensor<float>(new TensorShape(1, 3, inputShape.Get(2), inputShape.Get(3)));
            TextureConverter.ToTensor(tempTexture, input, textureTransform);
            worker.Schedule(input);

            // Complete the inference immediately and destroy the temporary texture
            worker.PeekOutput(0).CompleteAllPendingOperations();
            worker.PeekOutput(1).CompleteAllPendingOperations();
            worker.PeekOutput(2).CompleteAllPendingOperations();
            Destroy(tempTexture);
        }

        private IEnumerator RunInference()
        {
            if (!m_cameraAccess.IsPlaying)
            {
                yield break;
            }

            [DllImport("OVRPlugin", CallingConvention = CallingConvention.Cdecl)]
            static extern OVRPlugin.Result ovrp_GetNodePoseStateAtTime(double time, OVRPlugin.Node nodeId, out OVRPlugin.PoseStatef nodePoseState);
            if (!ovrp_GetNodePoseStateAtTime(OVRPlugin.GetTimeInSeconds(), OVRPlugin.Node.Head, out _).IsSuccess())
            {
                Debug.Log("ovrp_GetNodePoseStateAtTime failed, which means 'm_cameraAccess.GetCameraPose()' is not reliable, skipping.");
                yield break;
            }

            var cachedCameraPose = m_cameraAccess.GetCameraPose();

            // Update Capture data
            Texture targetTexture = m_cameraAccess.GetTexture();
            var currentResolution = m_cameraAccess.CurrentResolution;

            // Convert the texture to a Tensor and schedule the inference
            var textureTransform = new TextureTransform().SetDimensions(targetTexture.width, targetTexture.height, 3);
            using var input = new Tensor<float>(new TensorShape(1, 3, m_inputSize.x, m_inputSize.y));
            TextureConverter.ToTensor(targetTexture, input, textureTransform);

            // Schedule all model layers
            m_engine.Schedule(input);

            // Get the results. ReadbackAndCloneAsync waits for all layers to complete before returning the result
            var boxesAwaiter = (m_engine.PeekOutput(0) as Tensor<float>).ReadbackAndCloneAsync().GetAwaiter();
            while (!boxesAwaiter.IsCompleted)
            {
                yield return null;
            }
            using var boxes = boxesAwaiter.GetResult();
            if (boxes.shape[0] == 0)
            {
                yield break;
            }

            var classIDsAwaiter = (m_engine.PeekOutput(1) as Tensor<int>).ReadbackAndCloneAsync().GetAwaiter();
            while (!classIDsAwaiter.IsCompleted)
            {
                yield return null;
            }
            using var classIDs = classIDsAwaiter.GetResult();
            if (classIDs.shape[0] == 0)
            {
                Debug.LogError("classIDs.shape[0] == 0");
                yield break;
            }

            var scoresAwaiter = (m_engine.PeekOutput(2) as Tensor<float>).ReadbackAndCloneAsync().GetAwaiter();
            while (!scoresAwaiter.IsCompleted)
            {
                yield return null;
            }
            using var scores = scoresAwaiter.GetResult();
            if (scores.shape[0] == 0)
            {
                Debug.LogError("scores.shape[0] == 0");
                yield break;
            }

            NativeArray<Color32> cameraColors = default;
            var needsBlueSheetRescuePixels = m_useBlueSheetPrior && HasPotentialBlueSheetRescueCandidate(boxes, scores, m_scoreThreshold, m_smallBoxScoreThreshold, m_smallBoxMaxAreaRatio, m_inputSize);
            if (needsBlueSheetRescuePixels)
            {
                cameraColors = m_cameraAccess.GetColors();
            }
            NonMaxSuppression(
                m_detections,
                boxes,
                classIDs,
                scores,
                m_iouThreshold,
                m_scoreThreshold,
                m_smallBoxScoreThreshold,
                m_smallBoxMaxAreaRatio,
                m_inputSize,
                cameraColors,
                currentResolution,
                m_useBlueSheetPrior,
                m_blueSheetMinRatio,
                m_blueSheetSampleColumns,
                m_blueSheetSampleRows,
                out var diagnostics);

            if (m_useBlueSheetObjectFallback && m_detections.Count == 0)
            {
                if (!cameraColors.IsCreated)
                {
                    cameraColors = m_cameraAccess.GetColors();
                }

                if (TryFindBlueSheetObjectFallback(cameraColors, currentResolution, m_inputSize, out var fallbackBox, out var fallbackScore))
                {
                    m_detections.Add((0, fallbackBox));
                    diagnostics.FallbackDetectionCount = 1;
                    diagnostics.FallbackScore = fallbackScore;
                    diagnostics.FinalDetectionCount = m_detections.Count;
                }
            }

            LogDiagnostics(diagnostics);

            // Checking if spatial anchor is tracked ensures bounding boxes are placed at correct world space positIons.
            if (!m_cameraAccess.IsPlaying || m_detectionManager.m_spatialAnchor == null || !m_detectionManager.m_spatialAnchor.IsTracked)
            {
                yield break;
            }

            // Update UI.
            m_uiInference.DrawUIBoxes(m_detections, m_inputSize, cachedCameraPose);
        }

        private void LogDiagnostics(DetectionDiagnostics diagnostics)
        {
            if (!m_logDetectionDiagnostics || Time.time < m_nextDiagnosticLogTime)
            {
                return;
            }

            m_nextDiagnosticLogTime = Time.time + m_diagnosticLogInterval;
            Debug.Log(
                "WatermelonDetection " +
                $"raw={diagnostics.RawCandidateCount} " +
                $"maxScore={diagnostics.MaxScore:0.000} " +
                $"normalPass={diagnostics.NormalThresholdCount} " +
                $"small={diagnostics.SmallCandidateCount} " +
                $"maxSmallScore={diagnostics.MaxSmallScore:0.000} " +
                $"blueRescue={diagnostics.BlueRescueCandidateCount} " +
                $"maxBlueRatio={diagnostics.MaxBlueRatio:0.00} " +
                $"fallback={diagnostics.FallbackDetectionCount} " +
                $"fallbackScore={diagnostics.FallbackScore:0.00} " +
                $"filtered={diagnostics.FilteredCandidateCount} " +
                $"final={diagnostics.FinalDetectionCount}");
        }

        private static bool HasPotentialBlueSheetRescueCandidate(Tensor<float> boxes, Tensor<float> scores, float scoreThreshold, float smallBoxScoreThreshold, float smallBoxMaxAreaRatio, Vector2 inputSize)
        {
            NativeArray<float>.ReadOnly scoresArray = scores.AsReadOnlyNativeArray();
            for (var i = 0; i < scoresArray.Length; i++)
            {
                if (scoresArray[i] >= smallBoxScoreThreshold && scoresArray[i] < scoreThreshold)
                {
                    var box = new Vector4(boxes[i, 0], boxes[i, 1], boxes[i, 2], boxes[i, 3]);
                    if (IsSmallBox(box, inputSize, smallBoxMaxAreaRatio))
                    {
                        return true;
                    }
                }
            }

            return false;
        }

        private static void NonMaxSuppression(List<(int classId, Vector4 boundingBox)> outDetections, Tensor<float> boxes, Tensor<int> classIDs, Tensor<float> scores, float iouThreshold, float scoreThreshold, float smallBoxScoreThreshold, float smallBoxMaxAreaRatio, Vector2 inputSize, NativeArray<Color32> cameraColors, Vector2Int cameraResolution, bool useBlueSheetPrior, float blueSheetMinRatio, int blueSheetSampleColumns, int blueSheetSampleRows, out DetectionDiagnostics diagnostics)
        {
            outDetections.Clear();
            diagnostics = default;

            // Filter by score threshold first
            List<int> filteredIndices = new List<int>();
            NativeArray<float>.ReadOnly scoresArray = scores.AsReadOnlyNativeArray();
            diagnostics.RawCandidateCount = scoresArray.Length;
            for (int i = 0; i < scoresArray.Length; i++)
            {
                var score = scoresArray[i];
                var box = GetBox(i);
                var isSmallBox = IsSmallBox(box, inputSize, smallBoxMaxAreaRatio);
                var effectiveScoreThreshold = scoreThreshold;
                var blueRatio = useBlueSheetPrior
                    ? GetBlueSheetRatio(box, inputSize, cameraColors, cameraResolution, blueSheetSampleColumns, blueSheetSampleRows)
                    : 0f;

                diagnostics.MaxScore = Mathf.Max(diagnostics.MaxScore, score);
                diagnostics.MaxBlueRatio = Mathf.Max(diagnostics.MaxBlueRatio, blueRatio);
                if (score >= scoreThreshold)
                {
                    diagnostics.NormalThresholdCount++;
                }

                if (isSmallBox)
                {
                    diagnostics.SmallCandidateCount++;
                    diagnostics.MaxSmallScore = Mathf.Max(diagnostics.MaxSmallScore, score);
                }

                if (isSmallBox && useBlueSheetPrior && blueRatio >= blueSheetMinRatio)
                {
                    effectiveScoreThreshold = Mathf.Min(scoreThreshold, smallBoxScoreThreshold);
                    if (score >= smallBoxScoreThreshold && score < scoreThreshold)
                    {
                        diagnostics.BlueRescueCandidateCount++;
                    }
                }
                else if (isSmallBox && !useBlueSheetPrior)
                {
                    effectiveScoreThreshold = Mathf.Min(scoreThreshold, smallBoxScoreThreshold);
                }

                if (score >= effectiveScoreThreshold)
                {
                    filteredIndices.Add(i);
                }
            }
            diagnostics.FilteredCandidateCount = filteredIndices.Count;

            if (filteredIndices.Count == 0)
            {
                return;
            }

            // Sort filtered indices by scores in descending order
            filteredIndices.Sort((a, b) => scoresArray[b].CompareTo(scoresArray[a]));

            // Apply NMS algorithm
            bool[] suppressed = new bool[filteredIndices.Count];
            for (int i = 0; i < filteredIndices.Count; i++)
            {
                if (suppressed[i])
                    continue;

                int idx = filteredIndices[i];

                // Add this detection to results
                outDetections.Add((classIDs[idx], GetBox(idx)));

                // Suppress overlapping boxes regardless of class
                for (int j = i + 1; j < filteredIndices.Count; j++)
                {
                    if (suppressed[j])
                        continue;

                    int jdx = filteredIndices[j];

                    float iou = CalculateIoU(GetBox(idx), GetBox(jdx));
                    if (iou > iouThreshold)
                    {
                        suppressed[j] = true;
                    }
                }
            }
            diagnostics.FinalDetectionCount = outDetections.Count;

            Vector4 GetBox(int i) => new Vector4(boxes[i, 0], boxes[i, 1], boxes[i, 2], boxes[i, 3]);
        }

        private struct DetectionDiagnostics
        {
            public int RawCandidateCount;
            public int NormalThresholdCount;
            public int SmallCandidateCount;
            public int BlueRescueCandidateCount;
            public int FallbackDetectionCount;
            public int FilteredCandidateCount;
            public int FinalDetectionCount;
            public float MaxScore;
            public float MaxSmallScore;
            public float MaxBlueRatio;
            public float FallbackScore;
        }

        private bool TryFindBlueSheetObjectFallback(NativeArray<Color32> cameraColors, Vector2Int cameraResolution, Vector2Int inputSize, out Vector4 fallbackBox, out float fallbackScore)
        {
            fallbackBox = default;
            fallbackScore = 0f;
            if (!cameraColors.IsCreated || cameraResolution.x <= 0 || cameraResolution.y <= 0)
            {
                return false;
            }

            var width = Mathf.Min(m_fallbackSampleWidth, cameraResolution.x);
            var height = Mathf.Min(m_fallbackSampleHeight, cameraResolution.y);
            if (width <= 0 || height <= 0)
            {
                return false;
            }

            var blueMask = new bool[width * height];
            var objectMask = new bool[width * height];
            for (var y = 0; y < height; y++)
            {
                for (var x = 0; x < width; x++)
                {
                    var color = SampleCameraColor(cameraColors, cameraResolution, width, height, x, y, false);
                    var index = y * width + x;
                    blueMask[index] = IsBlueSheetPixel(color);
                    objectMask[index] = IsWatermelonLikePixel(color);
                }
            }

            if (!TryFindBestBlueSheetBlob(blueMask, objectMask, width, height, out var bestBlob))
            {
                for (var y = 0; y < height; y++)
                {
                    for (var x = 0; x < width; x++)
                    {
                        var color = SampleCameraColor(cameraColors, cameraResolution, width, height, x, y, true);
                        var index = y * width + x;
                        blueMask[index] = IsBlueSheetPixel(color);
                        objectMask[index] = IsWatermelonLikePixel(color);
                    }
                }

                if (!TryFindBestBlueSheetBlob(blueMask, objectMask, width, height, out bestBlob))
                {
                    return false;
                }
            }

            fallbackBox = ConvertBlobToInputBox(bestBlob, width, height, inputSize);
            fallbackScore = bestBlob.Score;
            return true;
        }

        private static Color32 SampleCameraColor(NativeArray<Color32> cameraColors, Vector2Int cameraResolution, int sampleWidth, int sampleHeight, int sampleX, int sampleY, bool flipY)
        {
            var normalizedX = (sampleX + 0.5f) / sampleWidth;
            var normalizedY = (sampleY + 0.5f) / sampleHeight;
            if (flipY)
            {
                normalizedY = 1f - normalizedY;
            }

            var pixelX = Mathf.Clamp(Mathf.RoundToInt(normalizedX * (cameraResolution.x - 1)), 0, cameraResolution.x - 1);
            var pixelY = Mathf.Clamp(Mathf.RoundToInt(normalizedY * (cameraResolution.y - 1)), 0, cameraResolution.y - 1);
            var pixelIndex = pixelY * cameraResolution.x + pixelX;
            return pixelIndex >= 0 && pixelIndex < cameraColors.Length ? cameraColors[pixelIndex] : default;
        }

        private bool TryFindBestBlueSheetBlob(bool[] blueMask, bool[] objectMask, int width, int height, out BlobData bestBlob)
        {
            bestBlob = default;
            var visited = new bool[objectMask.Length];
            var queue = new Queue<int>();
            var minArea = Mathf.Max(2, Mathf.RoundToInt(width * height * m_fallbackMinBlobAreaRatio));
            var maxArea = Mathf.Max(minArea, Mathf.RoundToInt(width * height * m_fallbackMaxBlobAreaRatio));

            for (var start = 0; start < objectMask.Length; start++)
            {
                if (visited[start] || !objectMask[start])
                {
                    continue;
                }

                var blob = FloodFillBlob(start, objectMask, blueMask, visited, queue, width, height);
                blob.BlueUnderRatio = CalculateBlueUnderRatio(blob, blueMask, width, height);
                var centerYRatio = (blob.MinY + blob.MaxY + 1) * 0.5f / height;
                if (blob.Area < minArea ||
                    blob.Area > maxArea ||
                    blob.GreenRatio < m_fallbackMinGreenRatio ||
                    blob.BlueUnderRatio < m_fallbackMinBlueUnderRatio ||
                    centerYRatio < m_fallbackMinCenterYRatio)
                {
                    continue;
                }

                var blobWidth = blob.MaxX - blob.MinX + 1;
                var blobHeight = blob.MaxY - blob.MinY + 1;
                var aspectRatio = blobHeight == 0 ? 999f : (float)blobWidth / blobHeight;
                if (aspectRatio < 0.35f || aspectRatio > 2.8f)
                {
                    continue;
                }

                blob.Score = blob.Area * Mathf.Lerp(0.5f, 1.5f, blob.GreenRatio) * Mathf.Lerp(0.5f, 1.5f, blob.BlueUnderRatio);
                if (blob.Score > bestBlob.Score)
                {
                    bestBlob = blob;
                }
            }

            return bestBlob.Area > 0;
        }

        private BlobData FloodFillBlob(int start, bool[] objectMask, bool[] blueMask, bool[] visited, Queue<int> queue, int width, int height)
        {
            var blob = new BlobData
            {
                MinX = width,
                MinY = height,
                MaxX = 0,
                MaxY = 0
            };

            visited[start] = true;
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                var index = queue.Dequeue();
                var x = index % width;
                var y = index / width;
                blob.Area++;
                blob.GreenPixels++;
                blob.MinX = Mathf.Min(blob.MinX, x);
                blob.MinY = Mathf.Min(blob.MinY, y);
                blob.MaxX = Mathf.Max(blob.MaxX, x);
                blob.MaxY = Mathf.Max(blob.MaxY, y);

                TryEnqueue(x - 1, y);
                TryEnqueue(x + 1, y);
                TryEnqueue(x, y - 1);
                TryEnqueue(x, y + 1);
            }

            blob.GreenRatio = blob.Area == 0 ? 0f : (float)blob.GreenPixels / blob.Area;
            return blob;

            void TryEnqueue(int nextX, int nextY)
            {
                if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
                {
                    return;
                }

                var nextIndex = nextY * width + nextX;
                if (visited[nextIndex] || !objectMask[nextIndex])
                {
                    return;
                }

                visited[nextIndex] = true;
                queue.Enqueue(nextIndex);
            }
        }

        private float CalculateBlueUnderRatio(BlobData blob, bool[] blueMask, int width, int height)
        {
            var blobWidth = blob.MaxX - blob.MinX + 1;
            var blobHeight = blob.MaxY - blob.MinY + 1;
            var paddingX = Mathf.Max(m_fallbackBlueSearchRadius, Mathf.RoundToInt(blobWidth * 0.35f));
            var bandHeight = Mathf.Max(m_fallbackBlueSearchRadius, Mathf.RoundToInt(blobHeight * 1.2f));
            var xMin = Mathf.Clamp(blob.MinX - paddingX, 0, width - 1);
            var xMax = Mathf.Clamp(blob.MaxX + paddingX, 0, width - 1);
            var yMin = Mathf.Clamp(blob.MaxY + 1, 0, height - 1);
            var yMax = Mathf.Clamp(blob.MaxY + bandHeight, 0, height - 1);
            if (yMax <= yMin)
            {
                return 0f;
            }

            var blueCount = 0;
            var totalCount = 0;
            for (var y = yMin; y <= yMax; y++)
            {
                for (var x = xMin; x <= xMax; x++)
                {
                    totalCount++;
                    if (blueMask[y * width + x])
                    {
                        blueCount++;
                    }
                }
            }

            return totalCount == 0 ? 0f : (float)blueCount / totalCount;
        }

        private Vector4 ConvertBlobToInputBox(BlobData blob, int sampleWidth, int sampleHeight, Vector2Int inputSize)
        {
            var centerX = (blob.MinX + blob.MaxX + 1) * 0.5f;
            var centerY = (blob.MinY + blob.MaxY + 1) * 0.5f;
            var width = Mathf.Max(2f, (blob.MaxX - blob.MinX + 1) * m_fallbackBoxPadding);
            var height = Mathf.Max(2f, (blob.MaxY - blob.MinY + 1) * m_fallbackBoxPadding);

            var x1 = Mathf.Clamp((centerX - width * 0.5f) / sampleWidth * inputSize.x, 0f, inputSize.x - 1f);
            var y1 = Mathf.Clamp((centerY - height * 0.5f) / sampleHeight * inputSize.y, 0f, inputSize.y - 1f);
            var x2 = Mathf.Clamp((centerX + width * 0.5f) / sampleWidth * inputSize.x, x1 + 1f, inputSize.x);
            var y2 = Mathf.Clamp((centerY + height * 0.5f) / sampleHeight * inputSize.y, y1 + 1f, inputSize.y);
            return new Vector4(x1, y1, x2, y2);
        }

        private struct BlobData
        {
            public int MinX;
            public int MinY;
            public int MaxX;
            public int MaxY;
            public int Area;
            public int GreenPixels;
            public float GreenRatio;
            public float BlueUnderRatio;
            public float Score;
        }

        private static bool IsSmallBox(Vector4 box, Vector2 inputSize, float maxAreaRatio)
        {
            if (maxAreaRatio <= 0f || inputSize.x <= 0f || inputSize.y <= 0f)
            {
                return false;
            }

            var width = Mathf.Max(0f, box.z - box.x);
            var height = Mathf.Max(0f, box.w - box.y);
            var areaRatio = width * height / (inputSize.x * inputSize.y);
            return areaRatio <= maxAreaRatio;
        }

        private static float GetBlueSheetRatio(Vector4 box, Vector2 inputSize, NativeArray<Color32> cameraColors, Vector2Int cameraResolution, int sampleColumns, int sampleRows)
        {
            if (!cameraColors.IsCreated || cameraResolution.x <= 0 || cameraResolution.y <= 0 || inputSize.x <= 0f || inputSize.y <= 0f)
            {
                return 0f;
            }

            var normalRatio = CalculateBlueSheetRatio(box, inputSize, cameraColors, cameraResolution, sampleColumns, sampleRows, false);
            var flippedRatio = CalculateBlueSheetRatio(box, inputSize, cameraColors, cameraResolution, sampleColumns, sampleRows, true);
            return Mathf.Max(normalRatio, flippedRatio);
        }

        private static float CalculateBlueSheetRatio(Vector4 box, Vector2 inputSize, NativeArray<Color32> cameraColors, Vector2Int cameraResolution, int sampleColumns, int sampleRows, bool flipY)
        {
            var boxWidth = Mathf.Clamp01((box.z - box.x) / inputSize.x);
            var boxHeight = Mathf.Clamp01((box.w - box.y) / inputSize.y);
            var xPadding = Mathf.Max(boxWidth * 0.25f, 0.01f);
            var xMin = Mathf.Clamp01(box.x / inputSize.x - xPadding);
            var xMax = Mathf.Clamp01(box.z / inputSize.x + xPadding);
            var yCenter = Mathf.Clamp01((box.y + (box.w - box.y) * 0.55f) / inputSize.y);
            var yMax = Mathf.Clamp01(box.w / inputSize.y);
            var yMin = Mathf.Clamp01(yCenter);
            var yBottom = Mathf.Clamp01(yMax + Mathf.Max(boxHeight * 1.5f, 0.03f));

            if (xMax <= xMin || yBottom <= yMin)
            {
                return 0f;
            }

            var blueCount = 0;
            var totalCount = 0;
            sampleColumns = Mathf.Max(2, sampleColumns);
            sampleRows = Mathf.Max(2, sampleRows);

            for (var row = 0; row < sampleRows; row++)
            {
                var yT = sampleRows == 1 ? 0.5f : (row + 0.5f) / sampleRows;
                var normalizedY = Mathf.Lerp(yMin, yBottom, yT);
                if (flipY)
                {
                    normalizedY = 1f - normalizedY;
                }

                var pixelY = Mathf.Clamp(Mathf.RoundToInt(normalizedY * (cameraResolution.y - 1)), 0, cameraResolution.y - 1);
                for (var column = 0; column < sampleColumns; column++)
                {
                    var xT = sampleColumns == 1 ? 0.5f : (column + 0.5f) / sampleColumns;
                    var normalizedX = Mathf.Lerp(xMin, xMax, xT);
                    var pixelX = Mathf.Clamp(Mathf.RoundToInt(normalizedX * (cameraResolution.x - 1)), 0, cameraResolution.x - 1);
                    var pixelIndex = pixelY * cameraResolution.x + pixelX;
                    if (pixelIndex < 0 || pixelIndex >= cameraColors.Length)
                    {
                        continue;
                    }

                    totalCount++;
                    if (IsBlueSheetPixel(cameraColors[pixelIndex]))
                    {
                        blueCount++;
                    }
                }
            }

            return totalCount == 0 ? 0f : (float)blueCount / totalCount;
        }

        private static bool IsBlueSheetPixel(Color32 color)
        {
            var r = color.r / 255f;
            var g = color.g / 255f;
            var b = color.b / 255f;
            Color.RGBToHSV(new Color(r, g, b), out var hue, out var saturation, out var value);

            var hueDegrees = hue * 360f;
            var hueLooksBlue = hueDegrees >= 180f && hueDegrees <= 260f;
            var blueDominates = b > r * 1.2f && b > g * 0.75f;
            return hueLooksBlue && saturation >= 0.25f && value >= 0.12f && blueDominates;
        }

        private static bool IsWatermelonLikePixel(Color32 color)
        {
            var r = color.r / 255f;
            var g = color.g / 255f;
            var b = color.b / 255f;
            Color.RGBToHSV(new Color(r, g, b), out var hue, out var saturation, out var value);

            var hueDegrees = hue * 360f;
            var greenOrYellowGreen = hueDegrees >= 45f && hueDegrees <= 170f;
            var greenDominatesEnough = g > r * 0.75f && g > b * 0.7f;
            return greenOrYellowGreen && greenDominatesEnough && saturation >= 0.18f && value >= 0.08f;
        }

        internal static float CalculateIoU(Vector4 boxA, Vector4 boxB)
        {
            // Boxes are in format (topLeftX, topLeftY, bottomRightX, bottomRightY)
            // Calculate intersection coordinates
            float x1 = Mathf.Max(boxA.x, boxB.x);
            float y1 = Mathf.Max(boxA.y, boxB.y);
            float x2 = Mathf.Min(boxA.z, boxB.z);
            float y2 = Mathf.Min(boxA.w, boxB.w);

            // Calculate intersection area
            float intersectionWidth = Mathf.Max(0, x2 - x1);
            float intersectionHeight = Mathf.Max(0, y2 - y1);
            float intersectionArea = intersectionWidth * intersectionHeight;

            // Calculate individual box areas
            float boxAArea = (boxA.z - boxA.x) * (boxA.w - boxA.y);
            float boxBArea = (boxB.z - boxB.x) * (boxB.w - boxB.y);

            // Calculate union area
            float unionArea = boxAArea + boxBArea - intersectionArea;

            // Return IoU (Intersection over Union)
            if (unionArea == 0)
                return 0;

            return intersectionArea / unionArea;
        }
    }
}
