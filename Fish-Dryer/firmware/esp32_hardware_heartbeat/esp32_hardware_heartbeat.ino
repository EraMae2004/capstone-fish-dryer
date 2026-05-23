      #include <WiFi.h>
      #include <HTTPClient.h>
      #include <WiFiClientSecure.h>
      #include <Preferences.h>
      #include "DHT.h"
      #include <time.h>

      // ============================================================================
      //                       IDENTITY & ASSIGNMENT (NO HARDCODE)
      // ----------------------------------------------------------------------------
      //  This sketch is FLASHED IDENTICALLY to every ESP32 board.
      //  Per-board identity comes from the MAC address. The numeric ID used by the
      //  Laravel + mobile app is assigned AT RUNTIME by the user from the mobile
      //  "Detect → Save" flow:
      //    1. Board boots, advertises itself to RTDB  discovery/{MAC}/...
      //    2. User taps "Detect Microcontrollers" in the app, sees this board.
      //    3. User saves it. App writes  assignments/{MAC} = <numeric id>  to RTDB.
      //    4. Board polls assignments/{MAC} every heartbeat, adopts the id, persists
      //       it to NVS, and starts publishing to  machines/{id}/hardware_status.
      //  No source edits required to add boards.
      // ============================================================================

      static String gDeviceMac;       // "AA:BB:CC:DD:EE:FF"
      static String gDeviceMacSafe;   // "AABBCCDDEEFF"  (path-safe for RTDB)
      static String gDeviceName;      // "Fish Dryer XXXX"  (last 4 hex of MAC)
      static int    gAssignedId = 0;  // 0 = not yet assigned; loaded from NVS
      static Preferences gPrefs;

      /** From RTDB `machines/{id}/session` — "running" / "paused" / "stopped". */
      static String gSessionStatus = "stopped";
      /** Fan demand 1..3 (from same RTDB node). Single relay: time‑multiplexed in `loop()`. */
      static int gFanSpeedLevel = 1;
      /** Drying target °C from RTDB session (used when session is `running`). */
      static float gSessionTargetC = 60.0f;

      // ===== BUZZER — drying session RUNNING only (never idle / paused / stopped / test) =====
      //  Faults: sensors bad, temp above target, still below target after 20 min drying.
      //  Pattern: 10 s ON, 10 s silent, repeat until resolved.
      /** Max remote test length (ms). */
      #ifndef HARDWARE_TEST_MAX_MS
      #define HARDWARE_TEST_MAX_MS 12000UL
      #endif
      /** Fault pattern: 10 s ON, 10 s OFF, repeat (20 s cycle). */
      #ifndef ALERT_BUZZ_ON_MS
      #define ALERT_BUZZ_ON_MS 10000UL
      #endif
      #ifndef ALERT_BUZZ_SILENT_MS
      #define ALERT_BUZZ_SILENT_MS 10000UL
      #endif
      /** Below target after this much drying time → temp fault buzzer. */
      #ifndef TEMP_BELOW_TARGET_AFTER_DRYING_MS
      /** Chamber below target → loud fault buzzer after this (default 45 s). */
      #define TEMP_BELOW_TARGET_AFTER_DRYING_MS (45UL * 1000UL)
      #endif
      /** One relay fan: level 1 = 33% duty, 2 = 67%, 3 = 100% (3 s cycle). */
      #ifndef FAN_SPEED_CYCLE_MS
      #define FAN_SPEED_CYCLE_MS 3000UL
      #endif
      #ifndef TEMP_TARGET_MARGIN_C
      #define TEMP_TARGET_MARGIN_C 0.5f
      #endif
      #ifndef ALERT_BUZZ_PERIOD_MS
      #define ALERT_BUZZ_PERIOD_MS (ALERT_BUZZ_ON_MS + ALERT_BUZZ_SILENT_MS)
      #endif
      static bool          gBuzzerHwPwmOn = false;
      static bool          gBuzzerAlarmEngaged = false;
      /** Wall-clock start of 10s ON / 10s OFF cycle (survives long HTTP blocking). */
      static unsigned long gBuzzerCycleAnchorMs = 0;
      static bool          gDrySessionLatched = false;
      static unsigned long gLastSessionActiveMs = 0;
      /** Wall clock when current `running` session started (for below-target buzzer). */
      static unsigned long gDryingSessionStartMs = 0;
      /** From RTDB session.fault_buzzer_armed — buzzer only (not fan/heaters). */
      static bool          gFaultBuzzerArmed = false;
      /** From RTDB session.session_active — true only while mobile drying is running. */
      static bool          gSessionActiveFlag = false;
      static uint8_t       gNullSessionPollStreak = 0;
      static bool          gBuzzerPinHigh = false;

      // Remote hardware test from mobile → RTDB `machines/{id}/test_command`.
      static String        gTestMode = "";           // "all" | "component" | ""
      static String        gTestComponent = "";
      static String        gLastTestRequestId = "";
      static unsigned long gTestModeUntilMs = 0;
      static unsigned long gLastTestCmdPollMs = 0;
      static unsigned long gLastSessionPollMs = 0;
      static int           gTestFanLevel = 3;

      // ================= WIFI / API — CHANGE PC IP HERE (must match phone app) =================
      const char* WIFI_SSID = "XuMinghao";
      const char* WIFI_PASS = "Connecthere";

      // PC IPv4 from `ipconfig` + run: php artisan serve --host=0.0.0.0 --port=8000
      // Must match fish-dryer-mobile/app.json -> expo.extra.apiBaseUrl (same IP, ends with /api).
      const char* API_URL = "http://10.173.245.15:8000/api/hardware/esp32/status";

      static const char* FIRMWARE_BUILD_TAG = "drying-lock-v38";

      // Laravel heartbeat: keeps `last_seen` + hardware rows in MySQL and mirrors RTDB when enabled.
      // Set to 0 only while debugging (e.g. API returns 500). If the app shows "offline" but RTDB
      // discovery updates, this was probably 0 — Laravel never saw a heartbeat.
      /** 0 = skip slow Laravel POST (fan/heaters keep working during drying). */
      #ifndef SEND_TO_LARAVEL
      #define SEND_TO_LARAVEL 0
      #endif
      /** 0 = ignore RTDB test_command (Overview drying only). */
      #ifndef ENABLE_RTDB_HARDWARE_TEST
      #define ENABLE_RTDB_HARDWARE_TEST 0
      #endif

      // ================= FIREBASE (set these before flashing) =================
      // RTDB URL example: https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app/
      // In Firebase RTDB "Test mode", you can write without auth tokens.
      const char* FIREBASE_DATABASE_URL = "https://capstone-fish-dryer-default-rtdb.asia-southeast1.firebasedatabase.app";
      /** If RTDB rules use legacy auth, paste Database secret here (same as Laravel FIREBASE_DATABASE_SECRET). Leave "" for open rules. */
      const char* FIREBASE_DB_SECRET = "";

      /** Set 1 only on a safe bench — short buzz + outputs (legacy; see WIRING_CHECK_AT_BOOT). */
      #ifndef ENABLE_POWER_ON_SELFTEST
      #define ENABLE_POWER_ON_SELFTEST 0
      #endif

      /**
       * Wiring verification at boot: ALL LEDs + fan + heater relays ON, buzzer chirps,
       * then holds so you can confirm connections. Heaters/fan may run — bench only.
       * Set to 0 after wiring is verified.
       */
      #ifndef WIRING_CHECK_AT_BOOT
      #define WIRING_CHECK_AT_BOOT 0
      #endif
      #ifndef WIRING_CHECK_HOLD_MS
      #define WIRING_CHECK_HOLD_MS 12000UL
      #endif

      /** Brief GREEN→YELLOW→RED sweep at boot (proves wiring). Set 0 to skip. */
      #ifndef LED_BOOT_SWEEP
      #define LED_BOOT_SWEEP 0
      #endif

      // ================= ONE PIN PER COMPONENT (do not wire two things to one GPIO) =================
      #define PIN_DHT22        4    // DHT22 DATA
      #define PIN_MOISTURE    35    // YL-69 A0 only
      #define PIN_DOOR        15    // MC38 reed (optional)
      #define PIN_FAN          5    // Fan relay IN (blue module)
      #define PIN_HEATER1     19    // Heater 1 SSR or relay IN
      #define PIN_HEATER2     18    // Heater 2 SSR or relay IN
      #define PIN_BUZZER      27    // Piezo + or active buzzer +
      #define PIN_LED_GREEN   32    // Drying = running
      #define PIN_LED_YELLOW  33    // Paused
      #define PIN_LED_RED     13    // Stopped / idle

      #define DHTPIN           PIN_DHT22
      #define MOISTURE_PIN     PIN_MOISTURE
      #define REED_PIN         PIN_DOOR
      #define RELAY_FAN        PIN_FAN
      #define RELAY_HEATER1    PIN_HEATER1
      #define RELAY_HEATER2    PIN_HEATER2
      #define BUZZER_PIN       PIN_BUZZER
      #define LED1             PIN_LED_GREEN
      #define LED2             PIN_LED_YELLOW
      #define LED3             PIN_LED_RED
      #define LED_GREEN        PIN_LED_GREEN
      #define LED_YELLOW       PIN_LED_YELLOW
      #define LED_RED          PIN_LED_RED

      // Fan relay: LOW on IN = ON (most blue 1-ch boards). If fan never clicks, set to 0.
      #ifndef RELAY_ACTIVE_LOW
      #define RELAY_ACTIVE_LOW 1
      #endif
      // Heaters on SSR-60DA: HIGH = ON. If heaters use blue relays like fan, set to 0.
      #ifndef HEATER_CONTROL_IS_SSR
      #define HEATER_CONTROL_IS_SSR 1
      #endif
      #ifndef RELAY_BOOT_CLICK_MS
      #define RELAY_BOOT_CLICK_MS 400
      #endif
      #ifndef LED_ON_IS_HIGH
      #define LED_ON_IS_HIGH 1
      #endif
      #ifndef START_WITH_OUTPUTS_ENERGIZED
      #define START_WITH_OUTPUTS_ENERGIZED 0
      #endif

      // Passive piezo — 4 kHz square wave is usually loudest (resonance ~2–4.5 kHz).
      #ifndef BUZZER_TONE_HZ
      #define BUZZER_TONE_HZ 4096
      #endif
      #ifndef BUZZER_PWM_DUTY
      #define BUZZER_PWM_DUTY 255
      #endif
      /** 0 = unassigned boards must not publish to machines/1/ until the app assigns them. */
      #ifndef FALLBACK_MACHINE_ID
      #define FALLBACK_MACHINE_ID 0
      #endif
      #ifndef ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT
      #define ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT 1
      #endif
      /** 1 = 3-pin active buzzer (steady HIGH). 0 = passive piezo on GPIO27 (needs PWM/tone). */
      #ifndef BUZZER_ACTIVE_HIGH
      #define BUZZER_ACTIVE_HIGH 0
      #endif
      /** Loud beep when drying starts (proves piezo wiring). 0 = off. */
      #ifndef BUZZER_DRYING_START_CHIRP_MS
      #define BUZZER_DRYING_START_CHIRP_MS 1200
      #endif
      #ifndef SESSION_ACTIVE_HOLD_MS
      #define SESSION_ACTIVE_HOLD_MS 15000UL
      #endif
      /** Beep at boot (proves GPIO27). 0 = off after wiring verified. */
      #ifndef BUZZER_BOOT_TEST_SEC
      #define BUZZER_BOOT_TEST_SEC 0
      #endif

      static bool gBuzzerTonePlaying = false;
      static uint32_t gBuzzerLastToggleUs = 0;
      static bool gBuzzerPinLevel = false;

      static bool sessionAllowsActuators();
      static int findMachineIdForMacInMachinesJson();
      static int effectiveSessionMachineId();
      static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody);

      #define DHTTYPE DHT22

      /**
       * Door-sensor presence detection (no user action required).
       *
       * Why digitalRead alone fails: with INPUT_PULLUP, a disconnected GPIO15 and a connected
       * reed with the door open BOTH read steady HIGH. There's no electrical difference visible
       * via digitalRead, so the old check falsely reported "working" with nothing connected.
       *
       * Trick: GPIO15 is also touch channel T3. Touch reads measure parasitic capacitance.
       * A bare floating pin has very low capacitance (touchRead returns a HIGH count, e.g. 70–95).
       * Even a short reed cable adds enough capacitance to drop the count noticeably (≈ 30–60).
       * We sample touchRead(T3) every heartbeat, restore INPUT_PULLUP, then run the jitter test.
       *
       * Threshold is conservative: anything reading ABOVE this count is treated as "no wire
       * connected". Default was 90; short reed leads often still read >90 → false "unplugged".
       * Raise toward ~130 if the door shows not_working with a real switch wired.
       */
      #ifndef DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD
      #define DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD 120
      #endif

      /** Set 1 to skip the touch "wire present" test and only use digital stability (reed only). */
      #ifndef DOOR_SENSOR_SKIP_TOUCH_CHECK
      #define DOOR_SENSOR_SKIP_TOUCH_CHECK 0
      #endif

      /** Max LOW/HIGH toggles during the jitter window; raise if a noisy line fails a good sensor. */
      #ifndef DOOR_SENSOR_MAX_JITTER_TRANSITIONS
      #define DOOR_SENSOR_MAX_JITTER_TRANSITIONS 48
      #endif

      /**
       * 0 = no door hardware in this build: always publish door_sensor as not_working and do not
       *     count the door in the fault buzzer (GPIO15 may float).
       * 1 = reed wired on GPIO15: run doorSensorElectricalOk() for status + alerts.
       */
      #ifndef HAVE_DOOR_SENSOR
      #define HAVE_DOOR_SENSOR 0
      #endif

      /** Touch channel for GPIO15. (ESP32 classic mapping.) */
      #ifndef REED_TOUCH_CHANNEL
      #define REED_TOUCH_CHANNEL T3
      #endif

      DHT dht(DHTPIN, DHTTYPE);

      unsigned long lastHeartbeatMs = 0;
      /** Just above DHT_MIN_INTERVAL_MS so every heartbeat can refresh DHT + RTDB without violating the 2s DHT rule. */
      const unsigned long HEARTBEAT_INTERVAL_MS = 2100;

      // DHT22 requires ≥ ~2 s between reads; polling faster returns NaN and makes status flicker.
      static unsigned long lastDhtPollMs = 0;
      static float cachedDhtT = NAN;
      static float cachedDhtH = NAN;
      static bool lastDhtReadOk = false;

      static inline void driveLed(int pin, bool on) {
        pinMode(pin, OUTPUT);
        const bool levelHigh = LED_ON_IS_HIGH ? on : !on;
        digitalWrite(pin, levelHigh ? HIGH : LOW);
      }

      static inline int relayPinLevel(bool coilOn) {
        if (RELAY_ACTIVE_LOW) {
          return coilOn ? LOW : HIGH;
        }
        return coilOn ? HIGH : LOW;
      }

      static inline void driveRelay(int pin, bool coilEnergized) {
        pinMode(pin, OUTPUT);
        digitalWrite(pin, relayPinLevel(coilEnergized));
      }

      /** Blue mechanical relay (fan): NO wiring, ACTIVE_LOW. */
      static inline void driveFanLoad(bool on) {
        driveRelay(RELAY_FAN, on);
      }

      /** SSR-60DA (heaters): terminals 1–2 = GPIO + GND; 3–4 = AC/DC load. HIGH = ON. */
      static inline void driveHeaterLoad(bool on) {
        pinMode(RELAY_HEATER1, OUTPUT);
        pinMode(RELAY_HEATER2, OUTPUT);
      #if HEATER_CONTROL_IS_SSR
        digitalWrite(RELAY_HEATER1, on ? HIGH : LOW);
        digitalWrite(RELAY_HEATER2, on ? HIGH : LOW);
      #else
        driveRelay(RELAY_HEATER1, on);
        driveRelay(RELAY_HEATER2, on);
      #endif
      }

      static bool fanLoadIsOn() {
        return relayOn(RELAY_FAN);
      }

      static bool heaterLoadIsOn(int pin) {
      #if HEATER_CONTROL_IS_SSR
        return digitalRead(pin) == HIGH;
      #else
        return relayOn(pin);
      #endif
      }

      /** RTDB `outputs` — session intent, not GPIO sampled mid-heartbeat. */
      static void appendOutputsTelemetry(String& root, bool dhtOk, float airC) {
        bool fanRep = false;
        bool h1Rep = false;
        bool h2Rep = false;
        if (hardwareTestActive()) {
          fanRep = fanLoadIsOn();
          h1Rep = heaterLoadIsOn(RELAY_HEATER1);
          h2Rep = heaterLoadIsOn(RELAY_HEATER2);
        } else if (sessionAllowsActuators()) {
          fanRep = fanLoadIsOn();
          h1Rep = heaterLoadIsOn(RELAY_HEATER1);
          h2Rep = heaterLoadIsOn(RELAY_HEATER2);
        }
        root += "\"fan_on\":"; root += fanRep ? "true" : "false";
        root += ",\"heater1_on\":"; root += h1Rep ? "true" : "false";
        root += ",\"heater2_on\":"; root += h2Rep ? "true" : "false";
        root += ",\"led1_on\":"; root += ledPinOn(LED1) ? "true" : "false";
        root += ",\"led2_on\":"; root += ledPinOn(LED2) ? "true" : "false";
        root += ",\"led3_on\":"; root += ledPinOn(LED3) ? "true" : "false";
        root += ",\"buzzer_on\":"; root += gBuzzerTonePlaying ? "true" : "false";
      }

      /** Boot bench test: you should hear/feel one relay click if VCC=5V and IN on GPIO5. */
      static void relayBootClickTest() {
      #if RELAY_BOOT_CLICK_MS > 0
        Serial.println("[relay] boot click test — should hear relay CLICK once");
        driveFanLoad(true);
        delay((unsigned long)RELAY_BOOT_CLICK_MS);
        driveFanLoad(false);
        Serial.print("[relay] IN pin GPIO");
        Serial.print(RELAY_FAN);
        Serial.print(" level after test=");
        Serial.println(digitalRead(RELAY_FAN));
        Serial.println("[relay] No click? Use 5V on VCC, GND shared, JD-VCC jumper on. Try RELAY_ACTIVE_LOW 0.");
      #endif
      }

      /** Obey DHT22 sampling interval (≥2 s); must align with HEARTBEAT_INTERVAL_MS to avoid stale NaN. */
      static const unsigned long DHT_MIN_INTERVAL_MS = 2000;

      /** Obey DHT22 sampling interval; refresh only when due. Returns true iff the most recent
       *  read succeeded (plausible T/H). On failure, clears cached values so the app does not
       *  keep showing old numbers after unplug. */
      static bool dhtReadPlausible(float t, float h) {
        if (isnan(t) || isnan(h)) return false;
        // Unplugged / floating DATA often returns 0,0 or tiny values — not a real DHT22 frame.
        if (t <= 1.0f && h <= 1.0f) return false;
        if (t == 0.0f && h == 0.0f) return false;
        return t >= -45.0f && t <= 85.0f && h >= 1.0f && h <= 100.0f;
      }

      static bool pollDhtIfDue() {
        const unsigned long now = millis();
        if (lastDhtPollMs != 0 && (now - lastDhtPollMs) < DHT_MIN_INTERVAL_MS) {
          return lastDhtReadOk;
        }

        // ESP32 Wi‑Fi stack can disturb the DHT one‑wire timing. Let the radio yield, then read
        // in the order the Adafruit examples use (humidity first, then temperature).
        yield();
        delay(50);
        const float h = dht.readHumidity();
        const float t = dht.readTemperature();
        const bool plausible = dhtReadPlausible(t, h);

        // Timestamp after the acquisition so the next poll is ≥2 s later (library also enforces).
        lastDhtPollMs = millis();

        lastDhtReadOk = plausible;
        if (plausible) {
          cachedDhtT = t;
          cachedDhtH = h;
        } else {
          cachedDhtT = NAN;
          cachedDhtH = NAN;
        }
        return lastDhtReadOk;
      }

      String statusWord(bool ok) { return ok ? "working" : "not_working"; }
      String statusUnknown() { return "unknown"; }

      // ===== Moisture calibration (ADC → %) =====
      // YL-69 on GPIO35: lower ADC = wetter, higher = drier. Swap if water raises ADC.
      #ifndef MOISTURE_YL69_DRY_ADC
      #define MOISTURE_YL69_DRY_ADC 4095
      #endif
      #ifndef MOISTURE_YL69_WET_ADC
      #define MOISTURE_YL69_WET_ADC 1200
      #endif
      #ifndef MOISTURE_LEARNED_SPAN_MIN
      #define MOISTURE_LEARNED_SPAN_MIN 800
      #endif

      static int MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
      static int MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
      static bool moistureBoundsInitialized = false;

      static int clampInt(int v, int lo, int hi) {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
      }

      static void updateMoistureBounds(int adc) {
        if (!moistureBoundsInitialized) {
          MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
          MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
          moistureBoundsInitialized = true;
        }

        // Expand bounds slowly to avoid spikes.
        if (adc > MOISTURE_DRY_ADC) MOISTURE_DRY_ADC = adc;
        if (adc < MOISTURE_WET_ADC) {
          MOISTURE_WET_ADC = adc;
          if (MOISTURE_WET_ADC < 800) MOISTURE_WET_ADC = 800;
        }

        // Keep a minimum span so percent doesn't explode.
        if (abs(MOISTURE_DRY_ADC - MOISTURE_WET_ADC) < 200) {
          MOISTURE_DRY_ADC += 100;
          MOISTURE_WET_ADC -= 100;
          if (MOISTURE_WET_ADC < 800) MOISTURE_WET_ADC = 800;
          if (MOISTURE_DRY_ADC > 4095) MOISTURE_DRY_ADC = 4095;
        }
      }

      static int moisturePercentFromAdc(int adc) {
        int dry = moistureBoundsInitialized ? MOISTURE_DRY_ADC : MOISTURE_YL69_DRY_ADC;
        int wet = moistureBoundsInitialized ? MOISTURE_WET_ADC : MOISTURE_YL69_WET_ADC;
        if (dry == wet) return 0;
        if (dry < wet) {
          const int t = dry;
          dry = wet;
          wet = t;
        }
        float pct = (float)(dry - adc) * 100.0f / (float)(dry - wet);
        return clampInt((int)lroundf(pct), 0, 100);
      }

      #ifndef MOISTURE_ADC_SAMPLES
      #define MOISTURE_ADC_SAMPLES 24
      #endif

      #ifndef MOISTURE_FLOAT_SPREAD_FAIL
      #define MOISTURE_FLOAT_SPREAD_FAIL 1100
      #endif
      #ifndef MOISTURE_FLOAT_LOW_ADC_MAX
      /** Unplugged GPIO35: pegged near 0 with very low spread (not wet fish readings). */
      #define MOISTURE_FLOAT_LOW_ADC_MAX 180
      #endif
      #ifndef MOISTURE_FLOAT_LOW_SPREAD_MAX
      #define MOISTURE_FLOAT_LOW_SPREAD_MAX 150
      #endif
      #ifndef MOISTURE_CONNECT_GOOD_SAMPLES
      #define MOISTURE_CONNECT_GOOD_SAMPLES 2
      #endif
      #ifndef MOISTURE_CONNECT_BAD_SAMPLES
      #define MOISTURE_CONNECT_BAD_SAMPLES 4
      #endif
      #ifndef MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES
      #define MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES 2
      #endif
      /** 0 = drying buzzer ignores moisture (DHT temp faults still alarm). */
      #ifndef MOISTURE_FAULT_BUZZER
      #define MOISTURE_FAULT_BUZZER 0
      #endif

      static bool gMoistureConnectedStable = false;
      static uint8_t gMoistureGoodStreak = 0;
      static uint8_t gMoistureBadStreak = 0;
      /** Latched ON after RTDB session=start until explicit stop (survives flaky GETs). */
      static bool gDryingOutputsLatched = false;

      /**
       * YL-69 A0: wet → low ADC, dry → high. Unplugged GPIO35 often hits 0 (min) with
       * noisy spread 150–400 — must not report fake 60–90% moisture.
       */
      static bool moistureProbeConnected(int avgAdc, int spread, int minAdc, int maxAdc) {
        (void)minAdc;
        if (spread > MOISTURE_FLOAT_SPREAD_FAIL) {
          return false;
        }
        if (maxAdc >= 4040 && minAdc <= 25 && spread < 100) {
          return false;
        }
        if (avgAdc <= 12 && spread < 90) {
          return false;
        }
        if (avgAdc < MOISTURE_FLOAT_LOW_ADC_MAX &&
            spread < MOISTURE_FLOAT_LOW_SPREAD_MAX) {
          return false;
        }
        if (avgAdc > 3950 && spread < 180) {
          return false;
        }
        /** GPIO35 only: unplugged ~0–120 ADC; probe connected usually ≥300. */
        return avgAdc >= 300 && avgAdc <= 4080 && spread <= 600;
      }

      /** Stable connect/disconnect for RTDB + buzzer (breadboard noise). */
      static bool moistureSensorReportOk(int avgAdc, int spread, int minAdc, int maxAdc) {
        return moistureConnectedDebounced(avgAdc, spread, minAdc, maxAdc);
      }

      static bool moistureHealthOk(int avgAdc, int spread, int minAdc, int maxAdc) {
        return moistureProbeConnected(avgAdc, spread, minAdc, maxAdc);
      }

      static void resetMoistureCalibration() {
        moistureBoundsInitialized = false;
        MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
        MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
      }

      /**
       * Debounce connect/disconnect. While connected, a single noisy "good" sample must not
       * reset the disconnect counter (floating GPIO35 causes false "working" for minutes).
       */
      static bool moistureConnectedDebounced(int avgAdc, int spread, int minAdc, int maxAdc) {
        const bool sampleOk = moistureProbeConnected(avgAdc, spread, minAdc, maxAdc);
        if (sampleOk) {
          if (gMoistureGoodStreak < 255) gMoistureGoodStreak++;
          if (!gMoistureConnectedStable) {
            gMoistureBadStreak = 0;
          } else if (gMoistureGoodStreak >= MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES) {
            gMoistureBadStreak = 0;
          }
        } else {
          gMoistureGoodStreak = 0;
          if (gMoistureBadStreak < 255) gMoistureBadStreak++;
        }
        if (!gMoistureConnectedStable &&
            gMoistureGoodStreak >= MOISTURE_CONNECT_GOOD_SAMPLES) {
          gMoistureConnectedStable = true;
          gMoistureBadStreak = 0;
        }
        if (gMoistureConnectedStable &&
            gMoistureBadStreak >= MOISTURE_CONNECT_BAD_SAMPLES) {
          gMoistureConnectedStable = false;
          gMoistureGoodStreak = 0;
          resetMoistureCalibration();
        }
        return gMoistureConnectedStable;
      }

      static void readMoistureAdcOnPin(int pin, int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        (void)analogRead(pin);
        delay(1);
        long sum = 0;
        int minV = 4095;
        int maxV = 0;
        int secondMinV = 4095;
        for (int i = 0; i < MOISTURE_ADC_SAMPLES; i++) {
          const int v = analogRead(pin);
          sum += v;
          if (v < minV) {
            secondMinV = minV;
            minV = v;
          } else if (v < secondMinV) {
            secondMinV = v;
          }
          if (v > maxV) maxV = v;
          delay(2);
        }
        avgOut = (int)(sum / MOISTURE_ADC_SAMPLES);
        spreadOut = maxV - minV;
        minOut = minV;
        maxOut = maxV;
        if (minV <= 15 && secondMinV < 4095 && secondMinV > minV + 8) {
          minOut = secondMinV;
          spreadOut = maxV - minOut;
        }
      }

      static void readMoistureAdc(int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        readMoistureAdcOnPin(PIN_MOISTURE, avgOut, spreadOut, minOut, maxOut);
      }

      static bool ledPinOn(int pin) {
        const int v = digitalRead(pin);
        return LED_ON_IS_HIGH ? (v == HIGH) : (v == LOW);
      }

      /**
       * Detect whether ANY wire is physically attached to GPIO15 (independent of door state).
       * Uses the touch sensor to measure parasitic capacitance: a bare GPIO returns a high
       * count, a connected wire returns a noticeably lower count. We average a few samples to
       * reject spurious readings, then put the pin back in INPUT_PULLUP for digital reads.
       */
      static bool doorWireConnected() {
      #if DOOR_SENSOR_SKIP_TOUCH_CHECK
        pinMode(REED_PIN, INPUT_PULLUP);
        return true;
      #endif
        const int kSamples = 8;
        uint32_t sum = 0;
        uint16_t maxv = 0;
        uint16_t minv = 0xFFFF;
        for (int i = 0; i < kSamples; i++) {
          const uint16_t v = touchRead(REED_TOUCH_CHANNEL);
          sum += v;
          if (v > maxv) maxv = v;
          if (v < minv) minv = v;
          delay(2);
        }
        // Restore digital input mode: touchRead leaves the pin in touch mode internally.
        pinMode(REED_PIN, INPUT_PULLUP);

        // Drop the worst (likely noise spike) sample, then average.
        const uint16_t avg = (uint16_t)((sum - maxv) / (kSamples - 1));

        Serial.print("DOOR touch avg=");
        Serial.print(avg);
        Serial.print(" min=");
        Serial.print(minv);
        Serial.print(" max=");
        Serial.println(maxv);

        // Lower count = higher capacitance = wire present.
        return avg < DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD;
      }

      /**
       * Final door health: must be physically wired (capacitive presence) AND electrically
       * stable (no jitter / floating-line chaos). Either failure ⇒ not_working in the app.
       */
      static bool doorSensorElectricalOk() {
        if (!doorWireConnected()) return false;

        int transitions = 0;
        int prev = digitalRead(REED_PIN);
        for (int i = 0; i < 63; i++) {
          delayMicroseconds(280);
          const int v = digitalRead(REED_PIN);
          if (v != prev) {
            transitions++;
            prev = v;
          }
        }
        return transitions <= DOOR_SENSOR_MAX_JITTER_TRANSITIONS;
      }

      /** RTDB/Laravel `components.door_sensor` — false when HAVE_DOOR_SENSOR is 0. */
      static bool doorSensorStatusForPayload() {
      #if !HAVE_DOOR_SENSOR
        return false;
      #else
        return doorSensorElectricalOk();
      #endif
      }

      /** Fault buzzer: ignore door when HAVE_DOOR_SENSOR is 0 so a floating GPIO15 never alarms. */
      static bool doorSensorOkForAlerts() {
      #if !HAVE_DOOR_SENSOR
        return true;
      #else
        return doorSensorElectricalOk();
      #endif
      }

      // Relays ACTIVE LOW: LOW = ON, HIGH = OFF
      bool relayOn(int pin) {
        const int v = digitalRead(pin);
        return RELAY_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
      }

      /** Real ESP32 self-check. Only returns true when this MCU is actually healthy.
       *  Used in place of the old hardcoded "working".
       *  Fails on: lost WiFi, low heap (heap leak / corruption), or recent crash reset.
       */
      static bool esp32SelfCheckOk() {
        if (WiFi.status() != WL_CONNECTED) return false;
        // WiFi + TLS + JSON buffers are heavy; 20k was overly strict on some boards (false "MCU fault").
        if (ESP.getFreeHeap() < 12 * 1024) return false;
        // Do not use esp_reset_reason() here — relay inrush often leaves PANIC (4) on boot while MCU is fine.
        return true;
      }

      static bool hardwareTestActive() {
        return gTestMode.length() > 0 && (long)(millis()) < (long)gTestModeUntilMs;
      }

      /** Hardware test (RTDB test_command) is only for the Components screen — never during drying. */
      static bool sessionBlocksHardwareTest() {
        return sessionStatusIsRunning() || sessionStatusIsPaused();
      }

      /** Stop local test outputs only — do not touch RTDB test_command (Hardware page owns that). */
      static void pauseLocalHardwareTestOnly() {
        if (gTestMode.length() == 0 && !hardwareTestActive()) {
          return;
        }
        gTestMode = "";
        gTestComponent = "";
        gTestModeUntilMs = 0;
        buzzerForceSilent();
        if (!gDryingOutputsLatched) {
          loadsHardwareAllOff();
        }
      }

      static bool sessionStatusIsRunning() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "running");
      }

      static bool sessionStatusIsActive() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "running" || s == "paused");
      }

      static bool sessionStatusIsPaused() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "paused");
      }

      static float gLastGoodAirC = NAN;
      static unsigned long gLastGoodAirMs = 0;

      /** DHT can glitch; keep last good reading so heaters are not stuck OFF during a run. */
      static float airCToUseForHeater(bool dhtOk, float airC) {
        if (dhtOk && !isnan(airC)) {
          gLastGoodAirC = airC;
          gLastGoodAirMs = millis();
          return airC;
        }
        if (!isnan(gLastGoodAirC) && (millis() - gLastGoodAirMs) < 180000UL) {
          return gLastGoodAirC;
        }
        if (gSessionTargetC > 1.0f) {
          return gSessionTargetC - 5.0f;
        }
        return NAN;
      }

      static bool dryingSessionRunning() {
        return sessionStatusIsRunning();
      }

      static bool sensorsBadForBuzzer(bool dhtOk, bool moistureOk, bool doorOk) {
        if (!dhtOk || !doorOk) {
          return true;
        }
      #if MOISTURE_FAULT_BUZZER
        if (!moistureOk) {
          return true;
        }
      #endif
        return false;
      }

      /**
       * Buzzer should be considered for faults only while a drying session is running.
       * Previously this required `gFaultBuzzerArmed` (RTDB flag) which prevented the
       * buzzer from engaging during active runs unless explicitly armed remotely.
       * Change: consider the session running state only so sensor/temp faults alarm
       * during any active drying session.
       */
      static bool dryingSessionActiveForBuzzer() {
        return sessionStatusIsRunning();
      }

      static bool tempFaultForBuzzer(bool dhtOk, float airC) {
        if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
          return false;
        }
        if (!dhtOk || isnan(airC) || gSessionTargetC <= 1.0f) {
          return false;
        }
        if (airC > (gSessionTargetC + TEMP_TARGET_MARGIN_C)) {
          return true;
        }
        if (airC < (gSessionTargetC - TEMP_TARGET_MARGIN_C)) {
          if (gDryingSessionStartMs == 0) {
            return false;
          }
          return (millis() - gDryingSessionStartMs) >= TEMP_BELOW_TARGET_AFTER_DRYING_MS;
        }
        return false;
      }

      static void applyFanSpeedForSession() {
        driveFanLoad(sessionAllowsActuators());
      }

      static void logActualLoadGpios(const char* why) {
        Serial.print("[gpio] ");
        Serial.print(why);
        Serial.print(" fanGPIO");
        Serial.print(RELAY_FAN);
        Serial.print("=");
        Serial.print(fanLoadIsOn() ? 1 : 0);
        Serial.print(" h1=");
        Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
        Serial.print(" h2=");
        Serial.print(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);
        Serial.print(" buzz=");
        Serial.print(gBuzzerTonePlaying || gBuzzerHwPwmOn ? 1 : 0);
        Serial.print(" ACTIVE_LOW=");
        Serial.println(RELAY_ACTIVE_LOW ? 1 : 0);
      }

      static void disengageBuzzerAlarm() {
        gBuzzerAlarmEngaged = false;
        gBuzzerCycleAnchorMs = 0;
        buzzerForceSilent();
      }

      static void engageBuzzerAlarm(unsigned long nowMs) {
        if (!gBuzzerAlarmEngaged) {
          gBuzzerAlarmEngaged = true;
          gBuzzerCycleAnchorMs = nowMs;
          Serial.println("[buzzer] fault — 10s ON / 10s OFF (wall clock)");
        }
      }

      /** Machine id for machines/{id}/session — assignment, MAC scan, then optional fallback. */
      static int effectiveSessionMachineId() {
        if (gAssignedId > 0) {
          return gAssignedId;
        }
        static int sMacScannedId = 0;
        static unsigned long sLastMacScanMs = 0;
        const unsigned long now = millis();
        if (sMacScannedId <= 0 &&
            (sLastMacScanMs == 0 || (now - sLastMacScanMs) > 8000UL)) {
          sLastMacScanMs = now;
          sMacScannedId = findMachineIdForMacInMachinesJson();
        }
        if (sMacScannedId > 0) {
          return sMacScannedId;
        }
      #if FALLBACK_MACHINE_ID > 0
        return FALLBACK_MACHINE_ID;
      #else
        return 0;
      #endif
      }

      /** Fan/heaters ON while drying latched (Overview Start or Serial 1). */
      static bool sessionAllowsActuators() {
        if (!gDryingOutputsLatched) {
          return false;
        }
        if (gSessionTargetC <= 1.0f) {
          gSessionTargetC = 60.0f;
        }
        return true;
      }

      static void loadsHardwareAllOff() {
        if (gDryingOutputsLatched) {
          return;
        }
        driveFanLoad(false);
        driveHeaterLoad(false);
      }

      static void logWhyLoadsBlocked() {
        static unsigned long lastMs = 0;
        const unsigned long now = millis();
        if (lastMs != 0 && (now - lastMs) < 10000UL) return;
        lastMs = now;
        Serial.print("[loads] BLOCKED id=");
        Serial.print(gAssignedId);
        Serial.print(" status=");
        Serial.print(gSessionStatus);
        Serial.print(" active=");
        Serial.print(gSessionActiveFlag ? 1 : 0);
        Serial.print(" targetC=");
        Serial.println(gSessionTargetC, 1);
      }

      /** Hard OFF — only from forceIdleSessionState (Stop), never from heartbeat/Laravel. */
      static void forceActuatorsOff() {
        if (gDryingOutputsLatched) {
          return;
        }
        driveFanLoad(false);
        driveHeaterLoad(false);
      }

      static void beginDryingOutputs(bool chirp) {
        gSessionStatus = "running";
        gSessionActiveFlag = true;
        gFaultBuzzerArmed = true;
        gDryingOutputsLatched = true;
        if (gSessionTargetC <= 1.0f) {
          gSessionTargetC = 60.0f;
        }
        applyDryingOutputsHard();
        applyLedsForSession("running");
        if (chirp) {
        #if BUZZER_DRYING_START_CHIRP_MS > 0
          Serial.println("[buzzer] drying-start");
          buzzerChirpLoudBlocking((unsigned long)BUZZER_DRYING_START_CHIRP_MS);
        #endif
        }
        logActuatorState("drying-on");
        logActualLoadGpios("drying");
      }

      /** Drive fan + heaters + short buzzer — call every loop while drying latched. */
      static void applyDryingOutputsHard() {
        driveFanLoad(true);
        driveHeaterLoad(true);
      }

      static void safetyCutLoadsUnlessRunning() {
        if (gDryingOutputsLatched || hardwareTestActive() || sessionAllowsActuators()) {
          return;
        }
        if (!fanLoadIsOn() && !heaterLoadIsOn(RELAY_HEATER1) && !heaterLoadIsOn(RELAY_HEATER2)) {
          return;
        }
        forceActuatorsOff();
        static unsigned long lastWarnMs = 0;
        const unsigned long now = millis();
        if (lastWarnMs == 0 || (now - lastWarnMs) > 8000UL) {
          lastWarnMs = now;
          Serial.println("[SAFETY] fan/heaters OFF — not in active drying session");
          logActuatorState("safety-cut");
        }
      }

      static void updateBuzzerFaultLatch(bool dhtOk, bool moistureOk, bool doorOk, float airC) {
        static bool sLoggedFault = false;
        if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
          disengageBuzzerAlarm();
          sLoggedFault = false;
          return;
        }
        const bool sensorFault = sensorsBadForBuzzer(dhtOk, moistureOk, doorOk);
        const bool tempFault = tempFaultForBuzzer(dhtOk, airC);
        const bool faultNow = sensorFault || tempFault;
        if (faultNow) {
          if (!sLoggedFault) {
            sLoggedFault = true;
            Serial.print("[buzzer] DRYING FAULT sensor=");
            Serial.print(sensorFault ? 1 : 0);
            Serial.print(" temp=");
            Serial.print(tempFault ? 1 : 0);
            Serial.print(" dht=");
            Serial.print(dhtOk ? 1 : 0);
            Serial.print(" moist=");
            Serial.print(moistureOk ? 1 : 0);
            Serial.print(" door=");
            Serial.print(doorOk ? 1 : 0);
            Serial.print(" airC=");
            Serial.print(airC, 1);
            Serial.print(" target=");
            Serial.println(gSessionTargetC, 1);
          }
          engageBuzzerAlarm(millis());
          return;
        }
        sLoggedFault = false;
        if (gBuzzerAlarmEngaged) {
          disengageBuzzerAlarm();
        }
      }

      /** 10s beep / 10s silent from anchor — not one toggle per loop (HTTP can block minutes). */
      static void applyBuzzerCycleFromClock(unsigned long nowMs) {
        if (!gBuzzerAlarmEngaged || gBuzzerCycleAnchorMs == 0) return;
        const unsigned long cycleMs = ALERT_BUZZ_ON_MS + ALERT_BUZZ_SILENT_MS;
        const unsigned long pos = (nowMs - gBuzzerCycleAnchorMs) % cycleMs;
        if (pos < ALERT_BUZZ_ON_MS) {
          buzzerDriveMaxLoud();
        } else if (gBuzzerHwPwmOn || gBuzzerTonePlaying) {
          buzzerForceSilent();
        }
      }

      static void clearCloudTestCommand() {
        if (gAssignedId <= 0) return;
        (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_command", "null");
      }

      /** Hardware off — only at end of 10 s ON window or session end. */
      static void buzzerForceSilent() {
        if (gBuzzerHwPwmOn) {
          ledcWrite(BUZZER_PIN, 0);
          ledcDetach(BUZZER_PIN);
          gBuzzerHwPwmOn = false;
        }
        noTone(BUZZER_PIN);
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, LOW);
        gBuzzerTonePlaying = false;
        gBuzzerPinHigh = false;
      }

      /** Loudest drive for passive piezo: full rail square wave (PWM is quieter). */
      static void buzzerDriveMaxLoud() {
        if (gBuzzerHwPwmOn) {
          ledcWrite(BUZZER_PIN, 0);
          ledcDetach(BUZZER_PIN);
          gBuzzerHwPwmOn = false;
        }
        noTone(BUZZER_PIN);
        pinMode(BUZZER_PIN, OUTPUT);
        const uint32_t halfUs = 500000UL / (uint32_t)BUZZER_TONE_HZ;
        const uint32_t now = micros();
        if ((uint32_t)(now - gBuzzerLastToggleUs) >= halfUs) {
          gBuzzerLastToggleUs = now;
          gBuzzerPinLevel = !gBuzzerPinLevel;
          digitalWrite(BUZZER_PIN, gBuzzerPinLevel ? HIGH : LOW);
        }
        gBuzzerTonePlaying = true;
        gBuzzerPinHigh = gBuzzerPinLevel;
      }

      static void buzzerHwStart() {
        #if BUZZER_ACTIVE_HIGH
        noTone(BUZZER_PIN);
        if (gBuzzerHwPwmOn) {
          ledcDetach(BUZZER_PIN);
          gBuzzerHwPwmOn = false;
        }
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, HIGH);
        gBuzzerTonePlaying = true;
        gBuzzerPinHigh = true;
        #else
        buzzerDriveMaxLoud();
        #endif
      }

      static void buzzerTickSquareWave() {
        buzzerDriveMaxLoud();
      }

      /** Block ~ms with maximum loudness (drying-start proof). */
      static void buzzerChirpLoudBlocking(unsigned long ms) {
        if (ms == 0) return;
        const unsigned long end = millis() + ms;
        while ((long)(end - millis()) > 0) {
          buzzerDriveMaxLoud();
          delayMicroseconds(50);
          yield();
        }
        buzzerForceSilent();
      }

      /** Hardware tests: PWM + square wave so passive piezos actually sound. */
      static void buzzerTestDrive() {
        #if BUZZER_ACTIVE_HIGH
        buzzerHwStart();
        #else
        buzzerHwStart();
        buzzerTickSquareWave();
        #endif
      }

      static void buzzerAlarmBlockingSeconds(int sec) {
        if (sec <= 0) return;
        Serial.print("[buzzer] boot test ");
        Serial.print(sec);
        Serial.println(" s");
        const unsigned long endMs = millis() + (unsigned long)sec * 1000UL;
        while ((long)(endMs - millis()) > 0) {
          buzzerTestDrive();
          delay(2);
        }
        buzzerForceSilent();
      }

      static void serviceBuzzer(bool dhtOk, bool moistureOk, bool doorOk, float airC) {
        const unsigned long now = millis();
        updateBuzzerFaultLatch(dhtOk, moistureOk, doorOk, airC);

        if (hardwareTestActive()) {
          disengageBuzzerAlarm();
          buzzerForceSilent();
          return;
        }

        if (!gBuzzerAlarmEngaged) {
          if (gBuzzerTonePlaying || gBuzzerHwPwmOn) buzzerForceSilent();
          return;
        }

        applyBuzzerCycleFromClock(now);
        if (gBuzzerAlarmEngaged) {
          buzzerDriveMaxLoud();
        }
      }

      void connectWifiBlocking(uint32_t timeoutMs = 15000) {
        if (WiFi.status() == WL_CONNECTED) return;

        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);
        WiFi.begin(WIFI_SSID, WIFI_PASS);

        Serial.print("Connecting WiFi");
        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
          delay(250);
          Serial.print(".");
        }
        Serial.println();

        if (WiFi.status() == WL_CONNECTED) {
          Serial.print("WiFi connected. IP: ");
          Serial.println(WiFi.localIP());
        } else {
          Serial.println("WiFi not connected.");
        }
      }

      static void syncClockOnce() {
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        // Best-effort; don't block forever.
        for (int i = 0; i < 20; i++) {
          time_t now = time(nullptr);
          if (now > 1700000000) return; // ~2023+
          delay(150);
        }
      }

      static String isoNow() {
        time_t now = time(nullptr);
        struct tm t;
        gmtime_r(&now, &t);
        char buf[32];
        // ISO8601 UTC
        snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
                t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
                t.tm_hour, t.tm_min, t.tm_sec);
        return String(buf);
      }

      /** Parse `2026-05-16T12:34:56Z` (UTC-ish) to epoch seconds; 0 if invalid. */
      static time_t parseIso8601Epoch(const String& iso) {
        if (iso.length() < 19) return 0;
        struct tm t = {};
        int y = 0, M = 0, d = 0, h = 0, m = 0, s = 0;
        if (sscanf(iso.c_str(), "%d-%d-%dT%d:%d:%d", &y, &M, &d, &h, &m, &s) < 6) {
          return 0;
        }
        t.tm_year = y - 1900;
        t.tm_mon = M - 1;
        t.tm_mday = d;
        t.tm_hour = h;
        t.tm_min = m;
        t.tm_sec = s;
        return mktime(&t);
      }

      static void appendRtdbAuthQuery(String& url) {
        if (strlen(FIREBASE_DB_SECRET) == 0) return;
        url += (url.indexOf('?') >= 0) ? "&" : "?";
        url += "auth=";
        url += FIREBASE_DB_SECRET;
      }

      static String rtdbGetText(const String& pathNoJsonSuffix) {
        if (WiFi.status() != WL_CONNECTED) return String();
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.setTimeout(6000);
        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";
        appendRtdbAuthQuery(url);
        http.begin(client, url);
        const int code = http.GET();
        String body;
        if (code >= 200 && code < 300) {
          body = http.getString();
        } else {
          Serial.print("[RTDB] GET ");
          Serial.print(code);
          Serial.print(" ");
          Serial.println(pathNoJsonSuffix);
        }
        http.end();
        return body;
      }

      /** Initialize MAC-based identity; load any persisted assignment from NVS. */
      static void initIdentity() {
        gDeviceMac = WiFi.macAddress();
        gDeviceMacSafe = gDeviceMac;
        gDeviceMacSafe.replace(":", "");
        gDeviceMacSafe.toUpperCase();
        // Friendly default name: "Fish Dryer ABCD" using last 4 hex of MAC.
        const String tail = gDeviceMacSafe.substring(gDeviceMacSafe.length() - 4);
        gDeviceName = String("Fish Dryer ") + tail;

        gPrefs.begin("fdmcu", false);
        gAssignedId = gPrefs.getInt("mcid", 0);
        // Optional persisted display name, set by user via app -> assignments/{MAC}/name.
        const String persistedName = gPrefs.getString("name", "");
        if (persistedName.length() > 0) gDeviceName = persistedName;
        gPrefs.end();
      }

      static void persistAssignment(int id, const String& name) {
        gPrefs.begin("fdmcu", false);
        gPrefs.putInt("mcid", id);
        if (name.length() > 0) gPrefs.putString("name", name);
        gPrefs.end();
      }

      /**
       * If assignments/{MAC} is missing, find machines/{id}/hardware_status whose mac matches
       * this board (same path the mobile app listens on).
       */
      static int findMachineIdForMacInMachinesJson() {
        const String body = rtdbGetText("machines");
        if (body.length() < 8 || body == "null") return 0;

        String needle = String("\"mac\":\"") + gDeviceMac + "\"";
        int macPos = body.indexOf(needle);
        if (macPos < 0) {
          needle = String("\"mac\":\"") + gDeviceMacSafe + "\"";
          macPos = body.indexOf(needle);
        }
        if (macPos < 0) return 0;

        const int sliceStart = macPos > 320 ? (macPos - 320) : 0;
        const String slice = body.substring(sliceStart, macPos);
        for (int i = (int)slice.length() - 1; i >= 1; i--) {
          if (slice[i] != '"') continue;
          const int end = i;
          int start = i - 1;
          while (start >= 0 && slice[start] != '"') start--;
          if (start < 0) continue;
          const String key = slice.substring(start + 1, end);
          if (key.length() == 0 || key.length() > 6) continue;
          bool digits = true;
          for (unsigned int k = 0; k < key.length(); k++) {
            if (!isdigit((unsigned char)key[k])) {
              digits = false;
              break;
            }
          }
          if (!digits) continue;
          int j = end + 1;
          while (j < (int)slice.length() && (slice[j] == ' ' || slice[j] == '\t')) j++;
          if (j < (int)slice.length() && slice[j] == ':') {
            const int id = key.toInt();
            if (id > 0) return id;
          }
        }
        return 0;
      }

      /** Read assignments/{macSafe} from RTDB and adopt any new ID/name. Returns true if updated. */
      static bool refreshAssignmentFromCloud() {
        String body = rtdbGetText(String("assignments/") + gDeviceMacSafe);
        if (body.length() == 0 || body == "null") {
          String macLower = gDeviceMacSafe;
          macLower.toLowerCase();
          const String alt = rtdbGetText(String("assignments/") + macLower);
          if (alt.length() > 0 && alt != "null") {
            body = alt;
          }
        }
        bool haveAssignment = (body.length() > 0 && body != "null");

        // Cheap JSON pick — avoids pulling ArduinoJson for two fields.
        int newId = gAssignedId;
        String newName = gDeviceName;
        const int idKey = body.indexOf("\"microcontroller_id\"");
        if (idKey >= 0) {
          int colon = body.indexOf(':', idKey);
          if (colon > 0) {
            int end = colon + 1;
            while (end < (int)body.length() && (body[end] == ' ' || body[end] == '\t')) end++;
            int numStart = end;
            while (end < (int)body.length() && (isdigit(body[end]) || body[end] == '-')) end++;
            if (end > numStart) newId = body.substring(numStart, end).toInt();
          }
        }
        // Plain numeric body (e.g. "5") is also accepted.
        if (idKey < 0) {
          String trimmed = body;
          trimmed.trim();
          if (trimmed.length() > 0 && (isdigit(trimmed[0]) || trimmed[0] == '-')) {
            newId = trimmed.toInt();
          }
        }
        if (haveAssignment) {
          const int nameKey = body.indexOf("\"name\"");
          if (nameKey >= 0) {
            int colon = body.indexOf(':', nameKey);
            int q1 = body.indexOf('"', colon + 1);
            int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
            if (q1 >= 0 && q2 > q1) newName = body.substring(q1 + 1, q2);
          }
        }

        if (newId <= 0) {
          const int scanned = findMachineIdForMacInMachinesJson();
          if (scanned > 0) {
            newId = scanned;
            Serial.print("[assignment] MAC match in machines/ -> id=");
            Serial.println(newId);
            String assignJson = "{\"microcontroller_id\":";
            assignJson += String(newId);
            assignJson += ",\"mac\":\"";
            assignJson += gDeviceMac;
            assignJson += "\"}";
            (void)rtdbPutJson(String("assignments/") + gDeviceMacSafe, assignJson);
          }
        }

        const bool changed = (newId != gAssignedId) || (newName.length() > 0 && newName != gDeviceName);
        if (changed) {
          if (newId != gAssignedId) {
            Serial.printf("[assignment] id changed %d -> %d\n", gAssignedId, newId);
          }
          gAssignedId = newId;
          if (newName.length() > 0) gDeviceName = newName;
          persistAssignment(gAssignedId, gDeviceName);
        }
        return changed;
      }

      static int parseJsonIntAfterKey(const String& body, const char* key, int defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        const int start = i;
        while (i < (int)body.length() && isdigit((unsigned char)body[i])) i++;
        if (i == start) return defV;
        return body.substring(start, i).toInt();
      }

      static float parseJsonFloatAfterKey(const String& body, const char* key, float defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        const int start = i;
        while (i < (int)body.length() &&
               (isdigit((unsigned char)body[i]) || body[i] == '.' || body[i] == '-' ||
                body[i] == 'e' || body[i] == 'E' || body[i] == '+')) {
          i++;
        }
        if (i == start) return defV;
        return body.substring(start, i).toFloat();
      }

      static void commitLoadRelays(bool dhtOk, float airC) {
        (void)dhtOk;
        (void)airC;
        if (gDryingOutputsLatched) {
          applyDryingOutputsHard();
          return;
        }
      #if ENABLE_RTDB_HARDWARE_TEST
        if (hardwareTestActive()) {
          return;
        }
      #endif
        loadsHardwareAllOff();
      }

      /** Drive the 3 status LEDs from a session-state string. */
      static void applyLedsForSession(const String& sessionStatus) {
        String s = sessionStatus;
        s.toLowerCase();
        s.trim();
        const bool running = (s == "running");
        const bool paused  = (s == "paused");
        const bool redOn   = !running && !paused;
        // Anything else (stopped, idle, "", null) → RED on.
        driveLed(LED_GREEN,  running);
        driveLed(LED_YELLOW, paused);
        driveLed(LED_RED,    redOn);

        static String lastLedSession = "";
        if (s != lastLedSession) {
          lastLedSession = s;
          Serial.print("[led] session=");
          Serial.print(s.length() ? s.c_str() : "stopped");
          Serial.print(" G=");
          Serial.print(running ? 1 : 0);
          Serial.print(" Y=");
          Serial.print(paused ? 1 : 0);
          Serial.print(" R=");
          Serial.print(redOn ? 1 : 0);
          Serial.print(" LED_ON_IS_HIGH=");
          Serial.println(LED_ON_IS_HIGH ? 1 : 0);
        }
      }

      static void forceIdleSessionState() {
        gDryingOutputsLatched = false;
        gSessionStatus = "stopped";
        gFaultBuzzerArmed = false;
        gSessionActiveFlag = false;
        gSessionTargetC = 0.0f;
        gNullSessionPollStreak = 0;
        gDrySessionLatched = false;
        gDryingSessionStartMs = 0;
        disengageBuzzerAlarm();
        pauseLocalHardwareTestOnly();
        forceActuatorsOff();
        applyLedsForSession("stopped");
      }

      static void logActuatorState(const char* why) {
        Serial.print("[actuator] ");
        Serial.print(why);
        Serial.print(" session=");
        Serial.print(gSessionStatus);
        Serial.print(" armed=");
        Serial.print(gFaultBuzzerArmed ? 1 : 0);
        Serial.print(" targetC=");
        Serial.print(gSessionTargetC, 1);
        Serial.print(" fan=");
        Serial.print(fanLoadIsOn() ? 1 : 0);
        Serial.print(" h1=");
        Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
        Serial.print(" h2=");
        Serial.print(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);
        Serial.print(" RELAY_ACTIVE_LOW=");
        Serial.println(RELAY_ACTIVE_LOW ? 1 : 0);
      }

      static void applySessionLedsOnly() {
        applyLedsForSession(
            gSessionStatus.length() ? gSessionStatus : String("stopped"));
      }

      /**
       * Pull `machines/{gAssignedId}/session` from RTDB (status, fan_speed, target_temperature).
       * Mobile writes the whole object on Start/Pause/Stop.
       */
      static void refreshSessionFromCloud() {
        if (gAssignedId <= 0) {
          (void)refreshAssignmentFromCloud();
        }
        const int mid = effectiveSessionMachineId();
        if (mid <= 0) {
          return;
        }

        const String sessionPath =
            String("machines/") + String(mid) + "/session";
        const String body = rtdbGetText(sessionPath);
        if (body.length() == 0) {
          static unsigned long lastGetFailLogMs = 0;
          const unsigned long now = millis();
          if (lastGetFailLogMs == 0 || (now - lastGetFailLogMs) > 8000UL) {
            lastGetFailLogMs = now;
            Serial.print("[session] GET failed ");
            Serial.print(sessionPath);
            Serial.print(" latched=");
            Serial.println(gDryingOutputsLatched ? 1 : 0);
          }
          if (gDryingOutputsLatched) {
            applyDryingOutputsHard();
          }
          return;
        }
        if (body == "null") {
          if (sessionStatusIsRunning()) {
            static unsigned long lastNullKeepLogMs = 0;
            const unsigned long now = millis();
            if (lastNullKeepLogMs == 0 || (now - lastNullKeepLogMs) > 15000UL) {
              lastNullKeepLogMs = now;
              Serial.println(
                  "[session] RTDB null — keeping DRYING until explicit stop");
            }
            return;
          }
          forceIdleSessionState();
          return;
        }
        gNullSessionPollStreak = 0;

        String command = parseJsonStringAfterKey(body, "command", "");
        command.toLowerCase();
        command.trim();

        if (command == "stop") {
          Serial.println("[session] command=stop");
          forceIdleSessionState();
          return;
        }

        const bool sessionActive =
            parseJsonBoolAfterKey(body, "session_active", false);
        if (command == "start" || sessionActive) {
          const float tt0 =
              parseJsonFloatAfterKey(body, "target_temperature", gSessionTargetC);
          if (tt0 > 1.0f && tt0 < 120.0f) {
            gSessionTargetC = tt0;
          }
          const int fs0 = parseJsonIntAfterKey(body, "fan_speed", gFanSpeedLevel);
          gFanSpeedLevel = fs0 < 1 ? 1 : (fs0 > 3 ? 3 : fs0);
          if (gAssignedId <= 0 && mid > 0) {
            gAssignedId = mid;
            persistAssignment(gAssignedId, gDeviceName);
          }
          const bool chirp = !gDryingOutputsLatched;
          if (!gDryingOutputsLatched) {
            gDryingSessionStartMs = millis();
            Serial.print("[session] DRYING START mid=");
            Serial.println(mid);
          }
          beginDryingOutputs(chirp);
          return;
        }

        String parsed = "stopped";
        String trimmed = body;
        trimmed.trim();
        if (trimmed.length() > 0 && trimmed != "null") {
          const int sq = trimmed.indexOf("\"status\"");
          if (sq >= 0) {
            const int colon = trimmed.indexOf(':', sq);
            const int q1 = trimmed.indexOf('"', colon + 1);
            const int q2 = q1 >= 0 ? trimmed.indexOf('"', q1 + 1) : -1;
            if (q1 >= 0 && q2 > q1) {
              parsed = trimmed.substring(q1 + 1, q2);
            }
          } else if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length() >= 2) {
            parsed = trimmed.substring(1, trimmed.length() - 1);
          } else if (trimmed.indexOf('{') < 0) {
            parsed = trimmed;
          }
        }

        const int fs = parseJsonIntAfterKey(body, "fan_speed", gFanSpeedLevel);
        gFanSpeedLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);

        if (command == "pause") {
          parsed = "paused";
        }

        parsed.toLowerCase();
        parsed.trim();
        if (parsed.length() == 0) {
          parsed = "stopped";
        }

        {
          static String gLastCloudSessionStatus;
          if (parsed != gLastCloudSessionStatus) {
            gLastCloudSessionStatus = parsed;
            Serial.print("[session] cloud status=");
            Serial.print(parsed);
            if (command.length() > 0) {
              Serial.print(" cmd=");
              Serial.print(command);
            }
            Serial.println();
          }
        }

        if (parsed == "stopped" || parsed == "idle" || parsed == "complete" ||
            parsed == "completed") {
          if (!gDryingOutputsLatched) {
            Serial.println("[session] cloud=stopped");
            forceIdleSessionState();
          }
          return;
        }

        if (parsed == "paused") {
          gDryingOutputsLatched = false;
          gSessionStatus = "paused";
          gSessionActiveFlag = false;
          gSessionTargetC = 0.0f;
          driveFanLoad(false);
          driveHeaterLoad(false);
          applyLedsForSession("paused");
          return;
        }

        if (parsed == "running") {
          const float tt =
              parseJsonFloatAfterKey(body, "target_temperature", gSessionTargetC);
          if (tt > 1.0f && tt < 120.0f) {
            gSessionTargetC = tt;
          }
          if (gAssignedId <= 0 && mid > 0) {
            gAssignedId = mid;
            persistAssignment(gAssignedId, gDeviceName);
          }
          beginDryingOutputs(!gDryingOutputsLatched);
          return;
        }

        if (!gDryingOutputsLatched) {
          static unsigned long lastUnkMs = 0;
          const unsigned long now = millis();
          if (lastUnkMs == 0 || (now - lastUnkMs) > 15000UL) {
            lastUnkMs = now;
            Serial.print("[session] idle parsed=");
            Serial.println(parsed);
          }
        }
      }

      static bool parseJsonBoolAfterKey(const String& body, const char* key, bool defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        if (body.startsWith("true", i)) return true;
        if (body.startsWith("false", i)) return false;
        return defV;
      }

      static String parseJsonStringAfterKey(const String& body, const char* key, const String& defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        const int q1 = body.indexOf('"', colon + 1);
        const int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
        if (q1 < 0 || q2 <= q1) return defV;
        return body.substring(q1 + 1, q2);
      }

      static void endHardwareTest() {
        gTestMode = "";
        gTestComponent = "";
        gTestModeUntilMs = 0;
        gTestFanLevel = 3;
        buzzerForceSilent();
        if (!gDryingOutputsLatched) {
          loadsHardwareAllOff();
        }
        applyLedsForSession(gSessionStatus);
        clearCloudTestCommand();
      }

      static void tickHardwareTestOutputs() {
        const unsigned long now = millis();
        if (sessionBlocksHardwareTest()) {
          pauseLocalHardwareTestOnly();
          return;
        }
        if (!hardwareTestActive()) {
          if (gTestMode.length() > 0) endHardwareTest();
          return;
        }

        if (gTestMode == "all") {
          applyLedsForSession(gSessionStatus);
          driveFanLoad(true);
          driveHeaterLoad(true);
          buzzerTestDrive();
          return;
        }

        if (gTestMode == "component") {
          String c = gTestComponent;
          c.toLowerCase();
          if (c == "fan" || c == "fan_1" || c == "fan_2" || c == "fan_3") {
            loadsHardwareAllOff();
            driveFanLoad(true);
            applyLedsForSession(gSessionStatus);
            return;
          }
          if (c == "heater" || c == "heater_1" || c == "heater_2") {
            loadsHardwareAllOff();
            driveHeaterLoad(true);
            applyLedsForSession(gSessionStatus);
            return;
          }
          if (c == "buzzer" || c == "piezo" || c == "piezo_buzzer") {
            loadsHardwareAllOff();
            buzzerTestDrive();
            applyLedsForSession(gSessionStatus);
            return;
          }
          const bool testsLed =
            (c == "esp32" || c == "led_1" || c == "led_2" || c == "led_3" ||
             c == "led_drying" || c == "led_pause" || c == "led_stop");

          if (testsLed) {
            const bool blink = ((now / 350UL) % 2UL) == 0UL;
            driveLed(LED_GREEN,  false);
            driveLed(LED_YELLOW, false);
            driveLed(LED_RED,    false);
            if (c == "esp32" || c == "led_1" || c == "led_drying") {
              driveLed(LED_GREEN, blink);
            } else if (c == "dht22" || c == "led_2" || c == "led_pause") {
              driveLed(LED_YELLOW, blink);
            } else if (c == "door_sensor" || c == "moisture_sensor" || c == "led_3" || c == "led_stop") {
              driveLed(LED_RED, blink);
            } else {
              driveLed(LED_GREEN, blink);
            }
          } else {
            applyLedsForSession(gSessionStatus);
          }

          loadsHardwareAllOff();
        }
      }

      static void refreshTestCommandFromCloud() {
        if (gAssignedId <= 0) {
          static unsigned long lastNoIdLogMs = 0;
          const unsigned long now = millis();
          if (lastNoIdLogMs == 0 || (now - lastNoIdLogMs) > 30000UL) {
            lastNoIdLogMs = now;
            Serial.println("[test] skip — Assigned ID is 0; save board in app (assignments/MAC)");
          }
          return;
        }
        if (sessionBlocksHardwareTest()) {
          pauseLocalHardwareTestOnly();
          return;
        }
        const String body = rtdbGetText(String("machines/") + String(gAssignedId) + "/test_command");
        if (body.length() == 0 || body == "null") {
          if (hardwareTestActive()) endHardwareTest();
          return;
        }

        const String mode = parseJsonStringAfterKey(body, "mode", "");
        const String component = parseJsonStringAfterKey(body, "component", "");
        const String reqId = parseJsonStringAfterKey(body, "request_id", "");
        int durationMs = parseJsonIntAfterKey(body, "duration_ms", 10000);
        if (durationMs < 2000) durationMs = 2000;
        if ((unsigned long)durationMs > HARDWARE_TEST_MAX_MS) {
          durationMs = (int)HARDWARE_TEST_MAX_MS;
        }

        if (mode != "all" && mode != "component") {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
          }
          return;
        }
        if (reqId.length() == 0) {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
          }
          return;
        }

        // CRITICAL: stale test_command in RTDB used to re-start Test All forever → endless buzzer.
        if (reqId == gLastTestRequestId) {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
            applyLedsForSession(gSessionStatus);
          }
          return;
        }

        gLastTestRequestId = reqId;
        gTestMode = mode;
        gTestComponent = component;
        gTestModeUntilMs = millis() + (unsigned long)durationMs;
        int fs = parseJsonIntAfterKey(body, "fan_speed", 3);
        gTestFanLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);
        Serial.print("[test] ");
        Serial.print(mode);
        Serial.print(" component=");
        Serial.print(component);
        Serial.print(" ms=");
        Serial.println(durationMs);
        String c = component;
        c.toLowerCase();
        if (gAssignedId > 0 && reqId.length() > 0) {
          String ack = "{\"request_id\":\"";
          ack += reqId;
          ack += "\",\"status\":\"running\",\"component\":\"";
          ack += component;
          ack += "\"}";
          (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_ack", ack);
        }
      }

      static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody) {
        if (WiFi.status() != WL_CONNECTED) return false;
        HTTPClient http;
        http.setTimeout(8000);

        // Firebase RTDB requires HTTPS. For quick test-mode validation, we skip cert validation.
        // (Do NOT ship like this; use certificate pinning or a proper client.)
        WiFiClientSecure client;
        client.setInsecure();

        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";
        appendRtdbAuthQuery(url);

        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");
        int code = http.PUT(jsonBody);
        String resp = http.getString();
        http.end();

        Serial.print("RTDB PUT ");
        Serial.print(code);
        Serial.print(" ");
        Serial.println(resp);

        return code >= 200 && code < 300;
      }

      static unsigned long gLastLaravelFailLogMs = 0;
      static unsigned long gLaravelPostBackoffUntilMs = 0;

      bool postJsonWithRetries(const String& payload, int retries = 3) {
        const unsigned long nowMs = millis();
        if (gLaravelPostBackoffUntilMs != 0 && (long)(nowMs - gLaravelPostBackoffUntilMs) < 0) {
          return false;
        }

        for (int attempt = 1; attempt <= retries; attempt++) {
          if (WiFi.status() != WL_CONNECTED) {
            connectWifiBlocking();
            if (WiFi.status() != WL_CONNECTED) {
              Serial.println("POST skipped: WiFi unavailable");
              delay(500);
              continue;
            }
          }

          HTTPClient http;
          WiFiClient client;
          http.setTimeout(4000);
          http.setConnectTimeout(3000);
          if (!http.begin(client, API_URL)) {
            Serial.println("Heartbeat: http.begin failed — check API_URL");
            delay(500);
            continue;
          }
          http.addHeader("Content-Type", "application/json");

          Serial.print("Posting heartbeat to ");
          Serial.print(API_URL);
          Serial.print(" (attempt ");
          Serial.print(attempt);
          Serial.println(")...");

          int code = http.POST(payload);
          String resp = http.getString();

          Serial.print("Heartbeat HTTP: ");
          Serial.println(code);
          if (code < 0) {
            if (gLastLaravelFailLogMs == 0 || (nowMs - gLastLaravelFailLogMs) > 60000UL) {
              gLastLaravelFailLogMs = nowMs;
              Serial.print("Heartbeat error: ");
              Serial.println(http.errorToString(code));
              Serial.println("Laravel unreachable — fix API_URL + artisan serve. RTDB/mobile still OK.");
            }
          }
          Serial.print("Heartbeat Resp: ");
          Serial.println(resp);

          http.end();

          if (code >= 200 && code < 300) {
            gLaravelPostBackoffUntilMs = 0;
            gLastLaravelFailLogMs = 0;
            return true;
          }

          if (!gDryingOutputsLatched && !hardwareTestActive() && !sessionAllowsActuators()) {
            loadsHardwareAllOff();
          }
          delay(200);
        }
        gLaravelPostBackoffUntilMs = millis() + 45000UL;
        return false;
      }

      static bool shouldForceLoadsOff() {
        if (gDryingOutputsLatched) {
          return false;
        }
        return !hardwareTestActive() && !sessionAllowsActuators();
      }

      void sendHeartbeat(bool /*dhtOk*/, bool /*moistureOk*/, bool /*doorOk*/) {
        (void)refreshAssignmentFromCloud();
        refreshSessionFromCloud();

        const bool esp32Ok = esp32SelfCheckOk();
        // `components.esp32` in JSON/RTDB = "MCU online" (Wi‑Fi path works). Heap/reset
        // self-check still drives Serial + alert buzzer via `esp32Ok`.
        const bool esp32UiOnline = (WiFi.status() == WL_CONNECTED);
        const bool dhtOkReport = pollDhtIfDue();
        const float t = cachedDhtT;
        const float h = cachedDhtH;

        int moistureRaw = 0;
        int spread = 0;
        int moistureMin = 0;
        int moistureMax = 0;
        readMoistureAdc(moistureRaw, spread, moistureMin, moistureMax);
        const bool moistureOkReport =
            moistureSensorReportOk(moistureRaw, spread, moistureMin, moistureMax);
        if (moistureOkReport) {
          updateMoistureBounds(moistureRaw);
        }
        const int moisturePct =
            moistureOkReport ? moisturePercentFromAdc(moistureRaw) : -1;

        const bool doorOkReport = doorSensorStatusForPayload();
        const bool doorOkAlert = doorSensorOkForAlerts();
        const int doorRaw = digitalRead(REED_PIN);
        const bool doorOpen = (doorRaw == LOW);

        // Calibration health: needs both initialized bounds and enough span to map ADC → %.
        // Span < 500 means we've only seen narrow values, so percentages will be wildly biased
        // until the user wets/dries the probe to widen the learned range.
        const int moistureSpanLearned = (MOISTURE_DRY_ADC > MOISTURE_WET_ADC)
            ? (MOISTURE_DRY_ADC - MOISTURE_WET_ADC)
            : (MOISTURE_WET_ADC - MOISTURE_DRY_ADC);
        const bool moistureCalibrated =
            moistureOkReport &&
            (moistureSpanLearned >= MOISTURE_LEARNED_SPAN_MIN ||
             moistureBoundsInitialized);

        Serial.print("MOISTURE raw=");
        Serial.print(moistureRaw);
        Serial.print(" min=");
        Serial.print(moistureMin);
        Serial.print(" max=");
        Serial.print(moistureMax);
        Serial.print(" spread=");
        Serial.print(spread);
        Serial.print(" gpio35=");
        Serial.print(analogRead(PIN_MOISTURE));
        Serial.print(" pct=");
        Serial.print(moistureOkReport ? moisturePct : -1);
        if (moistureOkReport && moisturePct <= 5 && moistureRaw > 3000) {
          Serial.print(" (dip water but ADC still high — swap MOISTURE_YL69_DRY/WET in .ino)");
        }
        Serial.print(" status=");
        Serial.print(moistureOkReport ? "OK" : "FAIL(disconnected)");
        Serial.print(" | DHT ");
        Serial.print(dhtOkReport ? "OK" : "FAIL");
        Serial.print(" | DOOR ");
        #if HAVE_DOOR_SENSOR
        Serial.print(doorOkReport ? "OK" : "FAIL");
        #else
        Serial.print("off(not installed)");
        #endif
        Serial.print(" | ESP32 ");
        Serial.print(esp32Ok ? "OK" : "FAIL");
        Serial.print(" heap=");
        Serial.println((unsigned int)ESP.getFreeHeap());

        {
          static bool sDiagLogged = false;
          if (!sDiagLogged &&
              (!dhtOkReport || !moistureOkReport ||
               (HAVE_DOOR_SENSOR && !doorOkReport) || !esp32Ok)) {
            sDiagLogged = true;
            Serial.print("[diag] reset_reason=");
            Serial.print((int)esp_reset_reason());
            Serial.print(" | HAVE_DOOR_SENSOR=");
            Serial.println(HAVE_DOOR_SENSOR ? 1 : 0);
          }
        }

        String payload;
        payload.reserve(900);

        payload += "{";
        payload += "\"microcontroller_id\":";
        payload += gAssignedId;
        // Always include MAC + name so Laravel can resolve unassigned boards by hardware identity.
        payload += ",\"device_id\":\""; payload += gDeviceName; payload += "\"";
        payload += ",\"mac\":\""; payload += gDeviceMac; payload += "\"";

        // Only sensors with real signals are reported. Outputs (LEDs, heaters, fans, buzzer)
        // have no feedback line, so the app intentionally does not list them.
        payload += ",\"components\":{";

        payload += "\"esp32\":\""; payload += statusWord(esp32UiOnline); payload += "\",";
        payload += "\"dht22\":\""; payload += statusWord(dhtOkReport); payload += "\",";
        payload += "\"moisture_sensor\":\""; payload += statusWord(moistureOkReport); payload += "\",";
        payload += "\"door_sensor\":\""; payload += statusWord(doorOkReport); payload += "\"";

        payload += "}";
        payload += ",\"readings\":{";
        {
          bool laravelReadingsFirst = true;
          auto laravelReadingsComma = [&]() {
            if (!laravelReadingsFirst) payload += ",";
            laravelReadingsFirst = false;
          };
          if (dhtOkReport && !isnan(t)) {
            laravelReadingsComma();
            payload += "\"temperature\":";
            payload += String(t, 1);
          }
          if (dhtOkReport && !isnan(h)) {
            laravelReadingsComma();
            payload += "\"humidity\":";
            payload += String(h, 1);
          }
          laravelReadingsComma();
          payload += "\"moisture_connected\":";
          payload += moistureOkReport ? "true" : "false";
          laravelReadingsComma();
          payload += "\"moisture_spread\":";
          payload += spread;
          laravelReadingsComma();
          payload += "\"moisture_raw\":";
          payload += moistureRaw;
          if (moistureOkReport && moisturePct >= 0) {
            laravelReadingsComma();
            payload += "\"moisture_percent\":";
            payload += moisturePct;
            laravelReadingsComma();
            payload += "\"moisture\":";
            payload += moisturePct;
            laravelReadingsComma();
            payload += "\"moisture_dry_adc\":";
            payload += MOISTURE_DRY_ADC;
            laravelReadingsComma();
            payload += "\"moisture_wet_adc\":";
            payload += MOISTURE_WET_ADC;
            laravelReadingsComma();
            payload += "\"moisture_span\":";
            payload += moistureSpanLearned;
            laravelReadingsComma();
            payload += "\"moisture_calibrated\":";
            payload += moistureCalibrated ? "true" : "false";
          }
        }
        payload += "}";
        payload += "}";

        // Push snapshot to Firebase RTDB first — mobile + Laravel read this path.
        // Only attach updated_at when wall clock is real; otherwise mobile uses snapshot-arrival
        // time as "fresh" (writing 1970-01-01 makes the app flip working → not_working).
        const time_t epoch = time(nullptr);
        const bool clockSynced = epoch > 1700000000;
        String root;
        root.reserve(800);
        root += "{";
        root += "\"microcontroller_id\":"; root += gAssignedId;
        // Per-board identity: name + MAC so the app can tell physical boards apart even if you reuse IDs.
        root += ",\"name\":\""; root += gDeviceName; root += "\"";
        root += ",\"device_id\":\""; root += gDeviceName; root += "\"";
        root += ",\"mac\":\""; root += gDeviceMac; root += "\"";
        // Mobile needs a parseable heartbeat time for "live" sensors. Without NTP, ISO would be
        // 1970 and look stale; Firebase expands {".sv":"timestamp"} to epoch ms on write.
        if (clockSynced) {
          root += ",\"updated_at\":\"";
          root += isoNow();
          root += "\"";
        } else {
          root += ",\"updated_at\":{\".sv\":\"timestamp\"}";
        }

        root += ",\"components\":{";
        root += "\"esp32\":\""; root += statusWord(esp32UiOnline); root += "\",";
        root += "\"door_sensor\":\""; root += statusWord(doorOkReport); root += "\",";
        root += "\"moisture_sensor\":\""; root += statusWord(moistureOkReport); root += "\",";
        root += "\"dht22\":\""; root += statusWord(dhtOkReport); root += "\"";
        root += "}";

        // Only publish readings for sensors that passed health checks — floating ADC / unplugged
        // probes still produce numbers and must not look like valid telemetry in the app.
        root += ",\"readings\":{";
        {
          bool readingsFirst = true;
          auto readingsComma = [&]() {
            if (!readingsFirst) root += ",";
            readingsFirst = false;
          };
          if (dhtOkReport && !isnan(t)) {
            readingsComma();
            root += "\"temperature\":";
            root += String(t, 1);
          }
          if (dhtOkReport && !isnan(h)) {
            readingsComma();
            root += "\"humidity\":";
            root += String(h, 1);
          }
          readingsComma();
          root += "\"moisture_connected\":";
          root += moistureOkReport ? "true" : "false";
          readingsComma();
          root += "\"moisture_spread\":";
          root += spread;
          readingsComma();
          root += "\"moisture_raw\":";
          root += moistureRaw;
          if (moistureOkReport && moisturePct >= 0) {
            readingsComma();
            root += "\"moisture\":";
            root += moisturePct;
            root += ",\"moisture_percent\":";
            root += moisturePct;
            readingsComma();
            root += "\"moisture_dry_adc\":";
            root += MOISTURE_DRY_ADC;
            readingsComma();
            root += "\"moisture_wet_adc\":";
            root += MOISTURE_WET_ADC;
            readingsComma();
            root += "\"moisture_span\":";
            root += moistureSpanLearned;
            readingsComma();
            root += "\"moisture_calibrated\":";
            root += moistureCalibrated ? "true" : "false";
          }
          if (doorOkReport) {
            readingsComma();
            root += "\"door\":\"";
            root += (doorOpen ? "open" : "closed");
            root += "\"";
          }
          readingsComma();
          root += "\"outputs\":{";
        }
        appendOutputsTelemetry(root, dhtOkReport, t);
        root += "}";
        root += "}";
        root += "}";

        // Only publish to machines/{id}/... once an ID has been assigned by the user
        // from the mobile app. Otherwise the board just advertises in discovery/.
        const int publishId = gAssignedId > 0 ? gAssignedId : effectiveSessionMachineId();
        if (publishId > 0) {
          if (gAssignedId <= 0) {
            gAssignedId = publishId;
            persistAssignment(gAssignedId, gDeviceName);
          }
          const bool rtdbOk =
              rtdbPutJson(String("machines/") + String(publishId) + "/hardware_status", root);
          static unsigned long lastRtdbOkLogMs = 0;
          if (!rtdbOk) {
            Serial.println("[RTDB] hardware_status PUT failed — check WiFi / Firebase rules");
          } else if (lastRtdbOkLogMs == 0 || (millis() - lastRtdbOkLogMs) > 30000UL) {
            lastRtdbOkLogMs = millis();
            Serial.print("[RTDB] telemetry OK machines/");
            Serial.print(publishId);
            Serial.println("/hardware_status");
          }
        } else {
          static unsigned long lastNoIdLogMs = 0;
          if (lastNoIdLogMs == 0 || (millis() - lastNoIdLogMs) > 15000UL) {
            lastNoIdLogMs = millis();
            Serial.println("[RTDB] skip machines/{id}/ — Assigned ID is 0; save board in app");
          }
        }

        if (sessionAllowsActuators()) {
          commitLoadRelays(dhtOkReport, t);
        } else if (shouldForceLoadsOff()) {
          forceActuatorsOff();
        }

        #if SEND_TO_LARAVEL
          if (!gDryingOutputsLatched) {
            postJsonWithRetries(payload, 2);
          }
        #endif

        // Discovery is only for *unassigned* boards (mobile "Detect" before claiming).
        // Once gAssignedId > 0, all live telemetry belongs under machines/{id}/hardware_status only.
        if (gAssignedId <= 0) {
          String adv;
          adv.reserve(360);
          adv += "{";
          adv += "\"microcontroller_id\":"; adv += gAssignedId;
          adv += ",\"name\":\""; adv += gDeviceName; adv += "\"";
          adv += ",\"device_id\":\""; adv += gDeviceName; adv += "\"";
          adv += ",\"mac\":\""; adv += gDeviceMac; adv += "\"";
          adv += ",\"ip\":\""; adv += WiFi.localIP().toString(); adv += "\"";
          adv += ",\"rssi\":"; adv += WiFi.RSSI();
          adv += ",\"assigned\":false";
          adv += ",\"moisture_connected\":"; adv += moistureOkReport ? "true" : "false";
          if (moistureOkReport && moisturePct >= 0) {
            adv += ",\"moisture_raw\":"; adv += moistureRaw;
            adv += ",\"moisture_percent\":"; adv += moisturePct;
          }
          if (clockSynced) {
            adv += ",\"updated_at\":\""; adv += isoNow(); adv += "\"";
          } else {
            adv += ",\"updated_at\":{\".sv\":\"timestamp\"}";
          }
          adv += "}";
          (void)rtdbPutJson(String("discovery/") + gDeviceMacSafe, adv);
        }
      }

      static void applySafeOutputDefaults() {
      #if START_WITH_OUTPUTS_ENERGIZED
        driveFanLoad(true);
        driveHeaterLoad(true);
      #else
        loadsHardwareAllOff();
      #endif
        // LEDs are session indicators (RED=stopped, YELLOW=paused, GREEN=running).
        // Default at boot = no session yet → RED on, others off. The next heartbeat
        // syncs to whatever session state the app/Laravel has set in Firebase.
        applyLedsForSession("stopped");
        buzzerForceSilent();
      }

      static void driveAllActuators(bool on) {
        driveLed(LED1, on);
        driveLed(LED2, on);
        driveLed(LED3, on);
        driveFanLoad(on);
        driveHeaterLoad(on);
        if (!on) buzzerForceSilent();
      }

      #if LED_BOOT_SWEEP
      /** One-time boot proof: each colour lights in order, then idle RED. */
      static void runBootLedSweep() {
        Serial.println("[led] boot sweep (GPIO32=G, 33=Y, 13=R)");
        driveLed(LED_GREEN,  true);
        driveLed(LED_YELLOW, false);
        driveLed(LED_RED,    false);
        delay(450);
        driveLed(LED_GREEN,  false);
        driveLed(LED_YELLOW, true);
        driveLed(LED_RED,    false);
        delay(450);
        driveLed(LED_GREEN,  false);
        driveLed(LED_YELLOW, false);
        driveLed(LED_RED,    true);
        delay(450);
        applyLedsForSession(gSessionStatus.length() ? gSessionStatus : String("stopped"));
      }
      #endif

      static void pumpDelayMs(unsigned long ms) {
        const unsigned long start = millis();
        while (millis() - start < ms) {
          delay(50);
          yield();
        }
      }

      #if WIRING_CHECK_AT_BOOT
      static void runBootWiringCheck() {
        Serial.println();
        Serial.println("========== WIRING CHECK ==========");
        Serial.println("LEDs + fan + heater relays ON. Buzzer chirps. HOLDING...");
        driveAllActuators(true);

        buzzerHwStart();
        delay(220);
        buzzerForceSilent();
        delay(120);
        buzzerHwStart();
        delay(220);
        buzzerForceSilent();

        pumpDelayMs(WIRING_CHECK_HOLD_MS);

      #if START_WITH_OUTPUTS_ENERGIZED
        Serial.println("Hold finished — outputs stay ON (START_WITH_OUTPUTS_ENERGIZED=1).");
      #else
        Serial.println("Hold finished — turning outputs OFF (safe idle).");
        driveAllActuators(false);
        applyLedsForSession("stopped");
      #endif
        Serial.println("==================================");
      }
      #endif

      #if ENABLE_POWER_ON_SELFTEST
      static void applyBenchSelfTestOutputs() {
        driveLed(LED1, true);
        driveLed(LED2, true);
        driveLed(LED3, true);

        driveFanLoad(true);
        driveHeaterLoad(true);

        buzzerHwStart();
        delay(120);
        buzzerForceSilent();
      }
      #endif

      static int gMoistureAvgCached = 0;
      static int gMoistureSpreadCached = 0;
      static int gMoistureMinCached = 4095;
      static int gMoistureMaxCached = 0;
      static unsigned long gLastMoistureSampleMs = 0;
      static unsigned long gLastAssignmentPollMs = 0;

      static void readSensorsOnce(bool& dhtOk, bool& moistureOk, bool& doorOk) {
        dhtOk = pollDhtIfDue();

        if (millis() - gLastMoistureSampleMs >= 250UL) {
          gLastMoistureSampleMs = millis();
          int minV = 0;
          int maxV = 0;
          readMoistureAdc(gMoistureAvgCached, gMoistureSpreadCached, minV, maxV);
          gMoistureMinCached = minV;
          gMoistureMaxCached = maxV;
        }
        moistureOk = moistureSensorReportOk(
            gMoistureAvgCached, gMoistureSpreadCached, gMoistureMinCached, gMoistureMaxCached);

        doorOk = doorSensorStatusForPayload();
      }

      void setup() {
        Serial.begin(115200);
        delay(500);

        Serial.println();
        Serial.println("##############################################");
        Serial.println("# Fish Dryer ESP32 — runtime-assigned identity");
        Serial.println("# (no MICROCONTROLLER_ID hardcoded in source)");
        Serial.print("# BUILD: ");
        Serial.println(FIRMWARE_BUILD_TAG);
        Serial.println("# PINS: DHT22=4 MOISTURE=35 DOOR=15 FAN=5 H1=19 H2=18 BUZZER=27");
        Serial.println("#       LED green=32 yellow=33 red=13");
        Serial.println("# Serial: 1+Enter = ON all loads+buzzer | 0+Enter = OFF");
        Serial.println("##############################################");
        Serial.printf("Reset reason: %d\n", (int)esp_reset_reason());

        pinMode(LED1, OUTPUT);
        pinMode(LED2, OUTPUT);
        pinMode(LED3, OUTPUT);

        pinMode(RELAY_FAN, OUTPUT);
        pinMode(RELAY_HEATER1, OUTPUT);
        pinMode(RELAY_HEATER2, OUTPUT);
        loadsHardwareAllOff();
        relayBootClickTest();

        pinMode(BUZZER_PIN, OUTPUT);
        buzzerForceSilent();
      #if BUZZER_BOOT_TEST_SEC > 0
        buzzerAlarmBlockingSeconds(BUZZER_BOOT_TEST_SEC);
      #endif

        pinMode(REED_PIN, INPUT_PULLUP);

        // ADC1 on GPIO35 (input-only). Plain INPUT — module drives AO; pull-down breaks many boards.
        pinMode(PIN_MOISTURE, INPUT);
        analogReadResolution(12);
        #ifdef ARDUINO_ARCH_ESP32
          analogSetAttenuation(ADC_11db);
          analogSetPinAttenuation(PIN_MOISTURE, ADC_11db);
        #endif

        applySafeOutputDefaults();

      #if WIRING_CHECK_AT_BOOT
        runBootWiringCheck();
      #elif ENABLE_POWER_ON_SELFTEST
        applyBenchSelfTestOutputs();
      #elif LED_BOOT_SWEEP
        runBootLedSweep();
      #endif

        connectWifiBlocking();
        syncClockOnce();

        // MAC is only valid after WiFi.mode/begin. Load persisted assignment from NVS,
        // then immediately try to refresh from the cloud so the very first heartbeat
        // already targets the correct machines/{id} path.
        initIdentity();
        (void)refreshAssignmentFromCloud();
        clearCloudTestCommand();
        gLastTestRequestId = "";
        gTestMode = "";
        gTestComponent = "";
        gTestModeUntilMs = 0;
        gFaultBuzzerArmed = false;
        disengageBuzzerAlarm();
        applyLedsForSession(gSessionStatus.length() ? gSessionStatus : String("stopped"));

        Serial.println("---- IDENTITY ----");
        Serial.print("MAC          : "); Serial.println(gDeviceMac);
        Serial.print("Name         : "); Serial.println(gDeviceName);
        Serial.print("Assigned ID  : "); Serial.println(gAssignedId);
        if (gAssignedId > 0) {
          Serial.print("RTDB path    : machines/"); Serial.print(gAssignedId); Serial.println("/hardware_status");
        } else {
          Serial.println("RTDB path    : (none — id is 0)");
          Serial.println("              Overview + sensors read machines/{id}/hardware_status.");
          Serial.println("              Save the board in the app OR set RTDB assignments/{MAC} so id > 0.");
        }
        Serial.print("Discovery    : discovery/"); Serial.println(gDeviceMacSafe);
        Serial.println("------------------");

        // Moisture bounds will self-calibrate during runtime.

        dht.begin();

        // DHT22: allow sensor to stabilize after power-up before first read (avoids endless NaN).
        delay(2000);

        Serial.println("=== HEARTBEAT START ===");
        Serial.print("Polarity: RELAY_ACTIVE_LOW=");
        Serial.print(RELAY_ACTIVE_LOW ? 1 : 0);
        Serial.print(" LED_ON_IS_HIGH=");
        Serial.print(LED_ON_IS_HIGH ? 1 : 0);
        Serial.print(" START_WITH_OUTPUTS_ENERGIZED=");
        Serial.print(START_WITH_OUTPUTS_ENERGIZED ? 1 : 0);
        Serial.print(" WIRING_CHECK_AT_BOOT=");
        Serial.println(WIRING_CHECK_AT_BOOT ? 1 : 0);
        Serial.print("[relay] NO-only COM→+ fan red→NO black→− ACTIVE_LOW=");
        Serial.print(RELAY_ACTIVE_LOW ? 1 : 0);
        Serial.print(" SSRheat=");
        Serial.print(HEATER_CONTROL_IS_SSR ? 1 : 0);
        Serial.print(" idle fan=");
        Serial.print(fanLoadIsOn() ? 1 : 0);
        Serial.print(" h1=");
        Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
        Serial.print(" h2=");
        Serial.println(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);

        bool dhtOk = false, moistureOk = false, doorOk = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk);
        (void)refreshSessionFromCloud();
        if (!gDryingOutputsLatched) {
          forceActuatorsOff();
        } else {
          applyDryingOutputsHard();
        }
        sendHeartbeat(dhtOk, moistureOk, doorOk);
        lastHeartbeatMs = millis();
      }

      /** Serial: type 1 + Enter = force fan/heaters/buzzer 30s (wiring test, no app). */
      static void pollSerialBenchOverride() {
        while (Serial.available() > 0) {
          const char c = (char)Serial.read();
          if (c == '1') {
            gDryingOutputsLatched = true;
            gSessionStatus = "running";
            gSessionTargetC = 60.0f;
            gSessionActiveFlag = true;
            applyDryingOutputsHard();
            Serial.println("[BENCH] Serial 1 — fan+heaters ON, loud buzzer 1.2s");
            buzzerChirpLoudBlocking(1200);
            applyDryingOutputsHard();
          } else if (c == '0') {
            forceIdleSessionState();
            Serial.println("[BENCH] Serial 0 — all outputs OFF");
          }
        }
      }

      void loop() {
        pollSerialBenchOverride();

        if (WiFi.status() != WL_CONNECTED) {
          connectWifiBlocking(8000);
        }

        bool dhtOk = false, moistureOk = false, doorOk = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk);

        if (gDryingOutputsLatched) {
          applyDryingOutputsHard();
        }

        if (millis() - gLastAssignmentPollMs >= 1000UL) {
          gLastAssignmentPollMs = millis();
          if (refreshAssignmentFromCloud()) {
            Serial.print("[assignment] active id=");
            Serial.println(gAssignedId);
          } else if (gAssignedId <= 0) {
            static unsigned long lastWarn = 0;
            const unsigned long now = millis();
            if (lastWarn == 0 || (now - lastWarn) > 15000UL) {
              lastWarn = now;
              Serial.println(
                  "[assignment] ID=0 — Save board in app OR ensure machines/{id} has this MAC");
            }
          }
        }
        if (millis() - gLastSessionPollMs >= 400UL) {
          gLastSessionPollMs = millis();
          refreshSessionFromCloud();
        }
        if (gDryingOutputsLatched || sessionAllowsActuators()) {
          applyDryingOutputsHard();
        }
      #if ENABLE_RTDB_HARDWARE_TEST
        if (!gDryingOutputsLatched && !sessionStatusIsRunning() && !sessionStatusIsPaused()) {
          if (millis() - gLastTestCmdPollMs >= 400UL) {
            gLastTestCmdPollMs = millis();
            refreshTestCommandFromCloud();
          }
        }
      #endif
        applySessionLedsOnly();
        commitLoadRelays(dhtOk, cachedDhtT);
      #if ENABLE_RTDB_HARDWARE_TEST
        if (!gDryingOutputsLatched) {
          tickHardwareTestOutputs();
        }
      #endif
        serviceBuzzer(dhtOk, moistureOk, doorSensorOkForAlerts(), cachedDhtT);
        if (gDryingOutputsLatched || sessionAllowsActuators()) {
          applyDryingOutputsHard();
        }
        safetyCutLoadsUnlessRunning();

        if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
          sendHeartbeat(dhtOk, moistureOk, doorOk);
      #if ENABLE_RTDB_HARDWARE_TEST
          if (!gDryingOutputsLatched) {
            tickHardwareTestOutputs();
          }
      #endif
          commitLoadRelays(dhtOk, cachedDhtT);
          lastHeartbeatMs = millis();
        }
        delay(5);
      }
