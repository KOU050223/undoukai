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
        [SerializeField, Range(0f, 1f)] private float m_watermelonSpatialBlend = 0.9f;
        [SerializeField, Min(0.1f)] private float m_watermelonDirectionCueDistance = 1.5f;
        [SerializeField, Range(0f, 1f)] private float m_watermelonStereoPanAssist = 0.8f;
        [SerializeField, Min(0.1f)] private float m_watermelonAudioMinDistance = 1.5f;
        [SerializeField, Min(0.1f)] private float m_watermelonAudioMaxDistance = 4f;
        [SerializeField] private bool m_enableWatermelonDirectionSpeech = true;
        [SerializeField, Min(0.5f)] private float m_watermelonSpeechInterval = 1.5f;
        [SerializeField, Range(0.5f, 2f)] private float m_watermelonSpeechRate = 1.15f;
        [SerializeField, Min(0.1f)] private float m_watermelonStopDistance = 1.2f;
        [SerializeField, Min(0.01f)] private float m_watermelonStopBoxHeight = 0.7f;
        [SerializeField, Range(5f, 60f)] private float m_watermelonStopMaxAngle = 30f;
        [SerializeField] private string m_watermelonStopSpeechText = "止まってください";
        [SerializeField, Range(0.1f, 0.9f)] private float m_watermelonFrontBackThreshold = 0.35f;
        [SerializeField, Range(0.1f, 0.9f)] private float m_watermelonLeftRightThreshold = 0.35f;
        [Space(10)]
        public UnityEvent<int> OnObjectsIdentified;

        private readonly List<DetectionSpawnMarkerAnim> m_spawnedEntities = new();
        private bool m_isStarted;
        internal OVRSpatialAnchor m_spatialAnchor;
        private bool m_isHeadsetTracking;
        private AudioSource m_watermelonAudioSource;
        private AudioClip m_watermelonBeepClip;
        private float m_nextWatermelonBeepTime;
        private readonly Dictionary<string, AudioClip> m_watermelonDirectionVoiceClips = new();
        private DirectionSpeech m_watermelonDirectionSpeech;
        private float m_nextWatermelonSpeechTime;
        private string m_lastWatermelonDirectionName;

        private void Awake()
        {
            StartCoroutine(UpdateSpatialAnchor());
            OVRManager.TrackingLost += OnTrackingLost;
            OVRManager.TrackingAcquired += OnTrackingAcquired;
            SetupWatermelonDirectionAudio();
            LoadWatermelonDirectionVoiceClips();
            m_watermelonDirectionSpeech = new DirectionSpeech(m_watermelonSpeechRate);
        }

        private void OnDestroy()
        {
            m_watermelonDirectionSpeech?.Shutdown();
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
            m_watermelonAudioSource.spatialBlend = m_watermelonSpatialBlend;
            m_watermelonAudioSource.rolloffMode = AudioRolloffMode.Linear;
            m_watermelonAudioSource.dopplerLevel = 0f;
            m_watermelonAudioSource.spread = 0f;
            m_watermelonAudioSource.priority = 32;
            m_watermelonAudioSource.reverbZoneMix = 0f;
            m_watermelonAudioSource.minDistance = m_watermelonAudioMinDistance;
            m_watermelonAudioSource.maxDistance = m_watermelonAudioMaxDistance;
            m_watermelonAudioSource.volume = m_watermelonBeepVolume;
            m_watermelonAudioSource.clip = CreateBeepClip(m_watermelonBeepFrequency, m_watermelonBeepDuration);
            m_watermelonBeepClip = m_watermelonAudioSource.clip;
        }

        private void UpdateWatermelonDirectionAudio()
        {
            if ((!m_enableWatermelonDirectionAudio && !m_enableWatermelonDirectionSpeech) ||
                !m_isStarted ||
                m_uiInference == null ||
                m_watermelonAudioSource == null)
            {
                return;
            }

            var target = GetClosestWatermelonBox();
            if (target == null)
            {
                m_nextWatermelonBeepTime = Time.time;
                m_nextWatermelonSpeechTime = Time.time;
                m_lastWatermelonDirectionName = null;
                return;
            }

            var listenerTransform = GetListenerTransform();
            var listenerPosition = listenerTransform != null ? listenerTransform.position : transform.position;
            var direction = target.BoxRectTransform.position - listenerPosition;
            var distanceSqr = GetHorizontalDistanceSqr(listenerPosition, target.BoxRectTransform.position);
            var localDirection = listenerTransform != null ? listenerTransform.InverseTransformDirection(direction) : Vector3.zero;
            if (ShouldStopForWatermelon(
                    distanceSqr,
                    target.BoxRectTransform.sizeDelta,
                    localDirection,
                    m_watermelonStopDistance,
                    m_watermelonStopBoxHeight,
                    m_watermelonStopMaxAngle))
            {
                m_watermelonAudioSource.transform.position = target.BoxRectTransform.position;
                m_watermelonAudioSource.panStereo = GetStereoPanAssist(direction.normalized, listenerTransform);
                SpeakWatermelonStop();
                m_nextWatermelonBeepTime = Time.time + m_watermelonBeepInterval;
                return;
            }

            if (direction.sqrMagnitude < 0.0001f)
            {
                direction = listenerTransform != null ? listenerTransform.forward : transform.forward;
            }

            direction.Normalize();
            m_watermelonAudioSource.transform.position = listenerPosition + direction * m_watermelonDirectionCueDistance;
            m_watermelonAudioSource.spatialBlend = m_watermelonSpatialBlend;
            m_watermelonAudioSource.minDistance = m_watermelonAudioMinDistance;
            m_watermelonAudioSource.maxDistance = m_watermelonAudioMaxDistance;
            m_watermelonAudioSource.volume = m_watermelonBeepVolume;
            m_watermelonAudioSource.panStereo = GetStereoPanAssist(direction, listenerTransform);
            var spokeDirection = SpeakWatermelonDirection(direction, listenerTransform);

            if (!m_enableWatermelonDirectionAudio)
            {
                return;
            }

            if (spokeDirection)
            {
                m_nextWatermelonBeepTime = Time.time + m_watermelonBeepInterval;
            }
            else if (Time.time >= m_nextWatermelonBeepTime)
            {
                m_watermelonAudioSource.PlayOneShot(m_watermelonBeepClip, m_watermelonBeepVolume);
                m_nextWatermelonBeepTime = Time.time + m_watermelonBeepInterval;
            }
        }

        private SentisInferenceUiManager.BoundingBoxData GetClosestWatermelonBox()
        {
            SentisInferenceUiManager.BoundingBoxData closest = null;
            var closestDistanceSqr = float.PositiveInfinity;
            var listenerTransform = GetListenerTransform();
            var listenerPosition = listenerTransform != null ? listenerTransform.position : transform.position;

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

        private static Transform GetListenerTransform()
        {
            var listener = UnityEngine.Object.FindFirstObjectByType<AudioListener>();
            return listener != null ? listener.transform : Camera.main != null ? Camera.main.transform : null;
        }

        private float GetStereoPanAssist(Vector3 worldDirection, Transform listenerTransform)
        {
            if (listenerTransform == null)
            {
                return 0f;
            }

            var localDirection = listenerTransform.InverseTransformDirection(worldDirection);
            return Mathf.Clamp(localDirection.x, -1f, 1f) * m_watermelonStereoPanAssist;
        }

        internal static bool IsWithinWatermelonStopDistance(float distanceSqr, float stopDistance)
        {
            return distanceSqr <= stopDistance * stopDistance;
        }

        internal static float GetHorizontalDistanceSqr(Vector3 from, Vector3 to)
        {
            var x = to.x - from.x;
            var z = to.z - from.z;
            return x * x + z * z;
        }

        internal static bool ShouldStopForWatermelon(
            float distanceSqr,
            Vector2 boxSize,
            Vector3 localDirection,
            float stopDistance,
            float stopBoxHeight,
            float stopMaxAngle)
        {
            return IsInWatermelonStopDirection(localDirection, stopMaxAngle) &&
                   (IsWithinWatermelonStopDistance(distanceSqr, stopDistance) || boxSize.y >= stopBoxHeight);
        }

        internal static bool IsInWatermelonStopDirection(Vector3 localDirection, float stopMaxAngle)
        {
            if (localDirection.sqrMagnitude < 0.0001f || localDirection.z <= 0f)
            {
                return false;
            }

            var angle = Mathf.Atan2(Mathf.Abs(localDirection.x), localDirection.z) * Mathf.Rad2Deg;
            return angle <= stopMaxAngle;
        }

        private bool SpeakWatermelonStop()
        {
            if (!m_enableWatermelonDirectionSpeech)
            {
                return false;
            }

            if (m_lastWatermelonDirectionName == m_watermelonStopSpeechText && Time.time < m_nextWatermelonSpeechTime)
            {
                return false;
            }

            if (TryPlayWatermelonDirectionVoice(m_watermelonStopSpeechText) ||
                m_watermelonDirectionSpeech.Speak(m_watermelonStopSpeechText))
            {
                m_lastWatermelonDirectionName = m_watermelonStopSpeechText;
                m_nextWatermelonSpeechTime = Time.time + m_watermelonSpeechInterval;
                return true;
            }

            return false;
        }

        private bool SpeakWatermelonDirection(Vector3 worldDirection, Transform listenerTransform)
        {
            if (!m_enableWatermelonDirectionSpeech || listenerTransform == null)
            {
                return false;
            }

            var directionName = GetJapaneseDirectionName(listenerTransform.InverseTransformDirection(worldDirection));
            if (directionName == m_lastWatermelonDirectionName && Time.time < m_nextWatermelonSpeechTime)
            {
                return false;
            }

            if (directionName != m_lastWatermelonDirectionName || Time.time >= m_nextWatermelonSpeechTime)
            {
                if (TryPlayWatermelonDirectionVoice(directionName) || m_watermelonDirectionSpeech.Speak($"{directionName}です"))
                {
                    m_lastWatermelonDirectionName = directionName;
                    m_nextWatermelonSpeechTime = Time.time + m_watermelonSpeechInterval;
                    return true;
                }
            }

            return false;
        }

        private string GetJapaneseDirectionName(Vector3 localDirection)
        {
            var horizontal = localDirection.x;
            var forward = localDirection.z;

            if (Mathf.Abs(horizontal) >= m_watermelonLeftRightThreshold &&
                Mathf.Abs(forward) >= m_watermelonFrontBackThreshold)
            {
                var side = horizontal < 0f ? "左" : "右";
                var depth = forward >= 0f ? "前" : "後ろ";
                return $"{side}{depth}";
            }

            if (Mathf.Abs(horizontal) > Mathf.Abs(forward))
            {
                return horizontal < 0f ? "左" : "右";
            }

            return forward >= 0f ? "前" : "後ろ";
        }

        private void LoadWatermelonDirectionVoiceClips()
        {
            AddDirectionVoiceClip("前", "front_voice");
            AddDirectionVoiceClip("後ろ", "back_voice");
            AddDirectionVoiceClip("左", "left_voice");
            AddDirectionVoiceClip("右", "right_voice");
            AddDirectionVoiceClip("左前", "front_left_voice");
            AddDirectionVoiceClip("右前", "front_right_voice");
            AddDirectionVoiceClip("左後ろ", "back_left_voice");
            AddDirectionVoiceClip("右後ろ", "back_right_voice");
            AddDirectionVoiceClip(m_watermelonStopSpeechText, "stop_voice");

            void AddDirectionVoiceClip(string directionName, string resourceName)
            {
                var clip = Resources.Load<AudioClip>($"WatermelonDirectionVoice/{resourceName}");
                if (clip == null)
                {
                    Debug.LogWarning($"Watermelon direction voice clip is missing: {resourceName}");
                    return;
                }

                m_watermelonDirectionVoiceClips[directionName] = clip;
            }
        }

        private bool TryPlayWatermelonDirectionVoice(string directionName)
        {
            if (m_watermelonAudioSource == null ||
                !m_watermelonDirectionVoiceClips.TryGetValue(directionName, out var clip))
            {
                return false;
            }

            m_watermelonAudioSource.PlayOneShot(clip, m_watermelonBeepVolume);
            return true;
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

        private sealed class DirectionSpeech
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            private readonly AndroidTextToSpeech m_androidTextToSpeech;
#endif

            public DirectionSpeech(float speechRate)
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                m_androidTextToSpeech = new AndroidTextToSpeech(speechRate);
#endif
            }

            public bool Speak(string text)
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                return m_androidTextToSpeech.Speak(text);
#else
                Debug.Log($"Watermelon direction: {text}");
                return true;
#endif
            }

            public void Shutdown()
            {
#if UNITY_ANDROID && !UNITY_EDITOR
                m_androidTextToSpeech.Shutdown();
#endif
            }
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        private sealed class AndroidTextToSpeech : AndroidJavaProxy
        {
            private AndroidJavaObject m_textToSpeech;
            private AndroidJavaObject m_activity;
            private readonly float m_speechRate;
            private bool m_isReady;
            private string m_pendingText;

            public AndroidTextToSpeech(float speechRate) : base("android.speech.tts.TextToSpeech$OnInitListener")
            {
                m_speechRate = speechRate;
                try
                {
                    using var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                    m_activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                    m_activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                    {
                        m_textToSpeech = new AndroidJavaObject("android.speech.tts.TextToSpeech", m_activity, this);
                    }));
                }
                catch (System.Exception exception)
                {
                    Debug.LogWarning($"TextToSpeech initialization failed: {exception.Message}");
                }
            }

            public void onInit(int status)
            {
                const int success = 0;
                if (status != success || m_textToSpeech == null)
                {
                    Debug.LogWarning($"TextToSpeech is not ready. status:{status}");
                    return;
                }

                try
                {
                    using var locale = new AndroidJavaClass("java.util.Locale").GetStatic<AndroidJavaObject>("JAPANESE");
                    var languageResult = m_textToSpeech.Call<int>("setLanguage", locale);
                    m_textToSpeech.Call<int>("setSpeechRate", m_speechRate);
                    m_isReady = true;
                    Debug.Log($"TextToSpeech is ready. languageResult:{languageResult}");

                    if (!string.IsNullOrEmpty(m_pendingText))
                    {
                        var pendingText = m_pendingText;
                        m_pendingText = null;
                        Speak(pendingText);
                    }
                }
                catch (System.Exception exception)
                {
                    Debug.LogWarning($"TextToSpeech language setup failed: {exception.Message}");
                }
            }

            public bool Speak(string text)
            {
                if (!m_isReady || m_textToSpeech == null)
                {
                    m_pendingText = text;
                    return false;
                }

                try
                {
                    m_activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                    {
                        using var parameters = new AndroidJavaObject("android.os.Bundle");
                        m_textToSpeech.Call<int>("speak", text, 0, parameters, "watermelon_direction");
                    }));
                    return true;
                }
                catch (System.Exception exception)
                {
                    Debug.LogWarning($"TextToSpeech speak failed: {exception.Message}");
                    return false;
                }
            }

            public void Shutdown()
            {
                if (m_textToSpeech == null)
                {
                    return;
                }

                var textToSpeech = m_textToSpeech;
                m_textToSpeech = null;
                m_isReady = false;
                m_pendingText = null;

                if (m_activity != null)
                {
                    m_activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                    {
                        textToSpeech.Call("stop");
                        textToSpeech.Call("shutdown");
                        textToSpeech.Dispose();
                    }));
                    m_activity.Dispose();
                    m_activity = null;
                }
                else
                {
                    textToSpeech.Call("stop");
                    textToSpeech.Call("shutdown");
                    textToSpeech.Dispose();
                }
            }
        }
#endif

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
