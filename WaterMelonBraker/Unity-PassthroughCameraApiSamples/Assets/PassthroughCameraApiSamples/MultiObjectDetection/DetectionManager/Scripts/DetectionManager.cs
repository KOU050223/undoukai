// Copyright (c) Meta Platforms, Inc. and affiliates.

using System.Collections;
using System.Collections.Generic;
using Meta.XR;
using Meta.XR.Samples;
using UnityEngine;
using UnityEngine.Events;

namespace PassthroughCameraSamples.MultiObjectDetection
{
    [MetaCodeSample("PassthroughCameraApiSamples-MultiObjectDetection")]
    public class DetectionManager : MonoBehaviour
    {
        [SerializeField] private PassthroughCameraAccess m_cameraAccess;

        [Header("Placement configuration")]
        [SerializeField] private DetectionSpawnMarkerAnim m_spawnMarker;

        [SerializeField] private SentisInferenceUiManager m_uiInference;

        [Header("Watermelon direction audio")]
        [SerializeField] private bool m_enableWatermelonDirectionAudio = true;
        [SerializeField] private string m_watermelonClassName = "watermelon";
        [SerializeField, Min(0.05f)] private float m_watermelonBeepInterval = 0.6f;
        [SerializeField, Min(0.02f)] private float m_watermelonBeepDuration = 0.12f;
        [SerializeField, Min(20f)] private float m_watermelonBeepFrequency = 880f;
        [SerializeField, Range(0f, 1f)] private float m_watermelonBeepVolume = 0.8f;
        [SerializeField, Min(0.1f)] private float m_watermelonAudioMinDistance = 0.2f;
        [SerializeField, Min(0.1f)] private float m_watermelonAudioMaxDistance = 8f;
        [Space(10)]
        public UnityEvent<int> OnObjectsIdentified;

        private readonly List<DetectionSpawnMarkerAnim> m_spawnedEntities = new();
        private bool m_isStarted;
        internal OVRSpatialAnchor m_spatialAnchor;
        private bool m_isHeadsetTracking;
        private AudioSource m_watermelonAudioSource;
        private AudioClip m_watermelonBeepClip;
        private float m_nextWatermelonBeepTime;

        private void Awake()
        {
            StartCoroutine(UpdateSpatialAnchor());
            OVRManager.TrackingLost += OnTrackingLost;
            OVRManager.TrackingAcquired += OnTrackingAcquired;
            SetupWatermelonDirectionAudio();
        }

        private void OnDestroy()
        {
            EraseSpatialAnchor();
            OVRManager.TrackingLost -= OnTrackingLost;
            OVRManager.TrackingAcquired -= OnTrackingAcquired;
        }

        private void OnTrackingLost() => m_isHeadsetTracking = false;
        private void OnTrackingAcquired() => m_isHeadsetTracking = true;

        private void Update()
        {
            if (!m_isStarted)
            {
                // Manage the Initial Ui Menu
                if (m_cameraAccess.IsPlaying)
                {
                    m_isStarted = true;
                }
            }
            else
            {
                // Press A button to spawn 3d markers
                if (InputManager.IsButtonADownOrPinchStarted())
                {
                    SpawnCurrentDetectedObjects();
                }
            }

            // Press B button to clean all markers
            if (InputManager.IsButtonBDownOrMiddleFingerPinchStarted())
            {
                CleanMarkers();
            }

            UpdateWatermelonDirectionAudio();
        }

        private void SetupWatermelonDirectionAudio()
        {
            var audioObject = new GameObject("WatermelonDirectionAudio");
            audioObject.transform.SetParent(transform, false);

            m_watermelonAudioSource = audioObject.AddComponent<AudioSource>();
            m_watermelonAudioSource.playOnAwake = false;
            m_watermelonAudioSource.loop = false;
            m_watermelonAudioSource.spatialBlend = 1f;
            m_watermelonAudioSource.rolloffMode = AudioRolloffMode.Linear;
            m_watermelonAudioSource.dopplerLevel = 0f;
            m_watermelonAudioSource.minDistance = m_watermelonAudioMinDistance;
            m_watermelonAudioSource.maxDistance = m_watermelonAudioMaxDistance;
            m_watermelonAudioSource.volume = m_watermelonBeepVolume;
            m_watermelonAudioSource.clip = CreateBeepClip(m_watermelonBeepFrequency, m_watermelonBeepDuration);
            m_watermelonBeepClip = m_watermelonAudioSource.clip;
        }

        private void UpdateWatermelonDirectionAudio()
        {
            if (!m_enableWatermelonDirectionAudio || !m_isStarted || m_uiInference == null || m_watermelonAudioSource == null)
            {
                return;
            }

            var target = GetClosestWatermelonBox();
            if (target == null)
            {
                m_nextWatermelonBeepTime = Time.time;
                return;
            }

            m_watermelonAudioSource.transform.position = target.BoxRectTransform.position;
            m_watermelonAudioSource.minDistance = m_watermelonAudioMinDistance;
            m_watermelonAudioSource.maxDistance = m_watermelonAudioMaxDistance;
            m_watermelonAudioSource.volume = m_watermelonBeepVolume;

            if (Time.time >= m_nextWatermelonBeepTime)
            {
                m_watermelonAudioSource.PlayOneShot(m_watermelonBeepClip, m_watermelonBeepVolume);
                m_nextWatermelonBeepTime = Time.time + m_watermelonBeepInterval;
            }
        }

        private SentisInferenceUiManager.BoundingBoxData GetClosestWatermelonBox()
        {
            SentisInferenceUiManager.BoundingBoxData closest = null;
            var closestDistanceSqr = float.PositiveInfinity;
            var listenerPosition = GetListenerPosition();

            foreach (var box in m_uiInference.m_boxDrawn)
            {
                if (!IsWatermelon(box.ClassName))
                {
                    continue;
                }

                var distanceSqr = (box.BoxRectTransform.position - listenerPosition).sqrMagnitude;
                if (distanceSqr < closestDistanceSqr)
                {
                    closestDistanceSqr = distanceSqr;
                    closest = box;
                }
            }

            return closest;
        }

        private Vector3 GetListenerPosition()
        {
            var listener = FindFirstObjectByType<AudioListener>();
            return listener != null ? listener.transform.position : Camera.main != null ? Camera.main.transform.position : transform.position;
        }

        private bool IsWatermelon(string className)
        {
            return !string.IsNullOrEmpty(className) &&
                   className.IndexOf(m_watermelonClassName, System.StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static AudioClip CreateBeepClip(float frequency, float duration)
        {
            const int sampleRate = 44100;
            var sampleCount = Mathf.Max(1, Mathf.CeilToInt(sampleRate * duration));
            var samples = new float[sampleCount];

            for (var i = 0; i < sampleCount; i++)
            {
                var time = (float)i / sampleRate;
                var fadeIn = Mathf.Clamp01(time / 0.01f);
                var fadeOut = Mathf.Clamp01((duration - time) / 0.02f);
                samples[i] = Mathf.Sin(2f * Mathf.PI * frequency * time) * fadeIn * fadeOut;
            }

            var clip = AudioClip.Create("WatermelonDirectionBeep", sampleCount, 1, sampleRate, false);
            clip.SetData(samples, 0);
            return clip;
        }

        private IEnumerator UpdateSpatialAnchor()
        {
            while (true)
            {
                yield return null;
                if (m_spatialAnchor == null)
                {
                    yield return CreateSpatialAnchorAndSave();
                    if (m_spatialAnchor == null)
                    {
                        continue;
                    }
                }

                if (!m_spatialAnchor.IsTracked)
                {
                    yield return RestoreSpatialAnchorTracking();
                }
            }

            IEnumerator CreateSpatialAnchorAndSave()
            {
                m_spatialAnchor = m_uiInference.ContentParent.gameObject.AddComponent<OVRSpatialAnchor>();

                // Wait for localization because SaveAnchorAsync() requires the anchor to be localized first.
                while (true)
                {
                    if (m_spatialAnchor == null)
                    {
                        // Spatial Anchor destroys itself when creation fails.
                        yield break;
                    }
                    if (m_spatialAnchor.Localized)
                    {
                        break;
                    }
                    yield return null;
                }

                // Save the anchor.
                var awaiter = m_spatialAnchor.SaveAnchorAsync().GetAwaiter();
                while (!awaiter.IsCompleted)
                {
                    yield return null;
                }
                var saveAnchorResult = awaiter.GetResult();
                if (!saveAnchorResult.Success)
                {
                    LogSpatialAnchor($"SaveAnchorAsync() failed {saveAnchorResult}", LogType.Error);
                    EraseSpatialAnchor();
                    yield break;
                }
                LogSpatialAnchor("created");
            }

            IEnumerator RestoreSpatialAnchorTracking()
            {
                // Try to restore spatial anchor tracking. If restoration fails, erase it.
                LogSpatialAnchor("tracking was lost, restoring...");
                const int numRetries = 20;
                for (int i = 0; i < numRetries; i++)
                {
                    yield return new WaitForSeconds(1f);
                    if (!m_isHeadsetTracking)
                    {
                        LogSpatialAnchor($"{nameof(m_isHeadsetTracking)} is false, retrying ({i})");
                        continue;
                    }

                    var unboundAnchors = new List<OVRSpatialAnchor.UnboundAnchor>(1);
                    var awaiter = OVRSpatialAnchor.LoadUnboundAnchorsAsync(new[]
                    {
                        m_spatialAnchor.Uuid
                    }, unboundAnchors).GetAwaiter();
                    while (!awaiter.IsCompleted)
                    {
                        yield return null;
                    }
                    var loadResult = awaiter.GetResult();
                    if (!loadResult.Success)
                    {
                        LogSpatialAnchor($"LoadUnboundAnchorsAsync() failed {loadResult.Status}, retrying ({i})", LogType.Error);
                        continue;
                    }
                    if (unboundAnchors.Count != 0)
                    {
                        LogSpatialAnchor($"LoadUnboundAnchorsAsync() unexpected count:{unboundAnchors.Count}, retrying ({i})", LogType.Error);
                        continue;
                    }
                    yield return null;
                    if (!m_spatialAnchor.IsTracked)
                    {
                        LogSpatialAnchor($"tracking is not restored, retrying ({i})");
                        continue;
                    }

                    LogSpatialAnchor("tracking was restored successfully");
                    yield break;
                }

                LogSpatialAnchor($"tracking restoration failed after {numRetries} retries", LogType.Warning);
                EraseSpatialAnchor();
            }
        }

        private void EraseSpatialAnchor()
        {
            if (m_spatialAnchor != null)
            {
                LogSpatialAnchor("EraseSpatialAnchor");
                m_spatialAnchor.EraseAnchorAsync();
                DestroyImmediate(m_spatialAnchor);
                m_spatialAnchor = null;

                CleanMarkers();
                m_uiInference.ClearAnnotations();
            }
        }

        private void CleanMarkers()
        {
            LogSpatialAnchor("CleanMarkers");
            foreach (var e in m_spawnedEntities)
            {
                Destroy(e.gameObject);
            }
            m_spawnedEntities.Clear();
            OnObjectsIdentified?.Invoke(-1);
        }

        private static void LogSpatialAnchor(string message, LogType logType = LogType.Log)
        {
            Debug.unityLogger.Log(logType, $"{nameof(OVRSpatialAnchor)}: {message}");
        }

        /// <summary>
        /// Spwan 3d markers for the detected objects
        /// </summary>
        private void SpawnCurrentDetectedObjects()
        {
            var newCount = 0;
            foreach (SentisInferenceUiManager.BoundingBoxData box in m_uiInference.m_boxDrawn)
            {
                if (!HasExistingMarkerInBoundingBox(box))
                {
                    LogSpatialAnchor($"spawn marker {box.ClassName}");
                    var marker = Instantiate(m_spawnMarker, box.BoxRectTransform.position, box.BoxRectTransform.rotation, m_uiInference.ContentParent);
                    marker.GetComponent<DetectionSpawnMarkerAnim>().SetYoloClassName(box.ClassName);

                    m_spawnedEntities.Add(marker);
                    newCount++;
                }
            }
            OnObjectsIdentified?.Invoke(newCount);

            bool HasExistingMarkerInBoundingBox(SentisInferenceUiManager.BoundingBoxData box)
            {
                foreach (var marker in m_spawnedEntities)
                {
                    if (marker.GetYoloClassName() == box.ClassName)
                    {
                        var markerWorldPos = marker.transform.position;
                        Vector2 localPos = box.BoxRectTransform.InverseTransformPoint(markerWorldPos);
                        var sizeDelta = box.BoxRectTransform.sizeDelta;
                        var currentBox = new Rect(
                            -sizeDelta.x * 0.5f,
                            -sizeDelta.y * 0.5f,
                            sizeDelta.x,
                            sizeDelta.y
                        );

                        if (currentBox.Contains(localPos))
                        {
                            return true;
                        }
                    }
                }

                return false;
            }
        }
    }
}
