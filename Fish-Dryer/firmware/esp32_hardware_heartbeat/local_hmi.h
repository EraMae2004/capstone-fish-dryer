/**
 * Local HMI — face layout:
 *
 * NUMBER (N):  1      2      3     mode
 *              4      5      6      <-
 *              7      8      9      ->
 *              0     Del  Enter  Stop
 *
 * CAPS (A):    ABC   DEF   GHI    mode
 *              JKL   MNO   PQR    <-
 *              STU   VWX   YZ     ->
 *              spc   Del  Enter  Stop
 *
 * SMALL (a):   abc   def   ghi    mode
 *              jkl   mno   pqr    <-
 *              stu   vwx   yz     ->
 *              spc   Del  Enter  Stop
 *
 * Keypad header LEFT→RIGHT pins 1→8 (GPIOs stay exactly as wired):
 *   1=13  2=12  3=14  4=27  5=26  6=25  7=33  8=32
 *   pins 1–4 = ROWS    pins 5–8 = COLS
 * A=mode B=<- C=-> D=Stop  *=face0  0=Del  #=Enter
 * LCD: SDA=21 SCL=23
 */

#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Keypad.h>
#include <string.h>
#if defined(ESP32)
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#endif

#ifndef ENABLE_LOCAL_HMI
#define ENABLE_LOCAL_HMI 1
#endif

#if ENABLE_LOCAL_HMI

#ifndef PIN_LCD_SDA
#define PIN_LCD_SDA 21
#endif
#ifndef PIN_LCD_SCL
#define PIN_LCD_SCL 23
#endif
#ifndef LCD_I2C_ADDR
#define LCD_I2C_ADDR 0x27
#endif
#ifndef HMI_MULTITAP_MS
#define HMI_MULTITAP_MS 1500UL
#endif
#ifndef HMI_PARAM_ROTATE_MS
#define HMI_PARAM_ROTATE_MS 5000UL
#endif
#ifndef HMI_DOOR_COUNTDOWN_S
#define HMI_DOOR_COUNTDOWN_S 5
#endif

void hmiOnStartDrying(const String& fishType, int totalFish, float targetC,
                      int durationSec, int fanSpeed);
void hmiOnStopDrying();
void hmiOnPauseDrying();
void hmiOnResumeDrying(const String& fishType, int totalFish, float targetC,
                      int remainingSec, int fanSpeed);
void hmiOnDurationComplete();
bool hmiSessionIsRunning();
bool hmiSessionIsPaused();
float hmiLiveTemperatureC();
float hmiLiveHumidity();
void hmiFormatDryingProblem(char* out, size_t outSz);
bool hmiHasDryingProblem();
bool hmiDht22NotWorking();
bool hmiDoorIsOpen();
bool hmiLocalDurationExpired();
long hmiRemainingDurationSec();

namespace LocalHmi {

#if defined(ESP32)
static SemaphoreHandle_t gUiMutex = nullptr;
static bool uiLock() {
  if (!gUiMutex) return false;
  return xSemaphoreTakeRecursive(gUiMutex, portMAX_DELAY) == pdTRUE;
}
static void uiUnlock(bool locked) {
  if (locked && gUiMutex) xSemaphoreGiveRecursive(gUiMutex);
}
#else
static bool uiLock() { return false; }
static void uiUnlock(bool) {}
#endif

class EspLcdI2c {
 public:
  uint8_t addr = LCD_I2C_ADDR;
  uint8_t bl = 0x08;
  bool ok = false;
  bool ping(uint8_t a) {
    for (int i = 0; i < 5; i++) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() == 0) return true;
      delay(5);
    }
    return false;
  }
  bool begin(uint8_t a) {
    addr = a;
    delay(100);
    write4(0x03); delay(5);
    write4(0x03); delay(5);
    write4(0x03); delay(1);
    write4(0x02); delay(5);
    cmd(0x28); delay(1);
    cmd(0x0C);
    cmd(0x06);
    cmd(0x01); delay(5);
    bl = 0x08;
    exp(bl);
    ok = true;
    return true;
  }
  void clear() {
    const bool locked = uiLock();
    needRecover = true;
    consumeRecover();
    cmd(0x01);
    delay(5);
    uiUnlock(locked);
  }
  void setCursor(uint8_t c, uint8_t r) {
    static const uint8_t off[] = {0x00, 0x40};
    cmd(0x80 | (off[r > 1 ? 1 : r] + c));
  }
  void printPad16(const char* s) {
    if (!s) s = "";
    for (uint8_t i = 0; i < 16; i++) {
      unsigned char c = (unsigned char)s[i];
      if (c == 0) {
        for (; i < 16; i++) data(' ');
        return;
      }
      if (c < 32 || c > 126) c = ' ';
      data(c);
    }
  }
  bool consumeRecover() {
    if (!needRecover) return false;
    needRecover = false;
    // Re-enter 4-bit mode without clearing the glass. One dropped nibble
    // otherwise turns every later character into a random glyph.
    write4(0x03); delay(5);
    write4(0x03); delay(5);
    write4(0x03); delay(1);
    write4(0x02); delay(2);
    cmd(0x28); delay(1);
    cmd(0x0C);
    cmd(0x06);
    return true;
  }
  bool needRecover = false;
  void writeChar(char c) { data((uint8_t)c); }
 private:
  void exp(uint8_t v) {
    Wire.beginTransmission(addr);
    Wire.write(v | bl);
    if (Wire.endTransmission() != 0) needRecover = true;
  }
  void pulse(uint8_t d) {
    const uint8_t bits = d & ~0x04;
    exp(bits);
    delayMicroseconds(40);
    exp(bits | 0x04);
    delayMicroseconds(20);
    exp(bits);
    delayMicroseconds(50);
  }
  void write4(uint8_t v) { pulse((v & 0x0F) << 4); }
  void send(uint8_t v, uint8_t mode) {
    pulse((v & 0xF0) | mode);
    pulse(((v << 4) & 0xF0) | mode);
  }
  void cmd(uint8_t v) { send(v, 0); }
  void data(uint8_t v) { send(v, 1); }
};

enum class Screen : uint8_t {
  Start,
  EditParams,
  ConfirmStart,
  DoorWarn,
  ContinueDoor,
  Running,
  StopOrPause,  // STOP left / PAUSE right — Enter=Pause, Stop=Stop+save
  ResumePrompt,  // power returned — GO continues, STOP saves
  Message,
  LcdSelfTest,
  KeypadSelfTest,
};

/** 16 unique face keys on the 4x4 pad (raw codes). */
static const char KEYPAD_TEST_KEYS[16] = {
    '1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'};

enum class InputMode : uint8_t { Numeric, AlphabetUpper, AlphabetLower };

static const uint8_t PARAM_COUNT = 4;
static const char* PARAM_LABELS[PARAM_COUNT] = {
    "Fish Name:", "Qty:", "Temp:", "Duration:",
};

static EspLcdI2c lcd;

static const byte ROWS = 4;
static const byte COLS = 4;
// GPIOs stay YOUR pins 1–8 (1–4 rows, 5–8 cols). Do not change them.
// Face lines 1 2 3 MODE and 4 5 6 <- were swapped; swap only those digit keys.
static char keys[ROWS][COLS] = {
    {'D', 'C', 'A', 'B'},
    {'#', '9', '3', '6'},
    {'0', '8', '2', '5'},
    {'*', '7', '1', '4'},
};
static byte rowPins[ROWS] = {13, 12, 14, 27};
static byte colPins[COLS] = {26, 25, 33, 32};
static Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

static bool gReady = false;
static bool gLcdOk = false;
static bool gKeypadOk = false;
static Screen gScreen = Screen::Start;
static InputMode gMode = InputMode::AlphabetUpper;
static uint8_t gParamIdx = 0;
static String gParams[PARAM_COUNT];
static unsigned long gMessageUntilMs = 0;
static Screen gMessageReturn = Screen::Start;

static char gTapKey = 0;
static uint8_t gTapPos = 0;
static unsigned long gTapMs = 0;
static unsigned long gLastKeypressMs = 0;

static uint8_t gDoorCountLeft = HMI_DOOR_COUNTDOWN_S;
static unsigned long gDoorTickMs = 0;
static uint8_t gRunPage = 0;  // 0 Fish+Qty, 1 Temp+Left, 2 Now+Humidity, 3 Problem, 4 DHT22 warning
static unsigned long gRunPageMs = 0;
static unsigned long gRunTickMs = 0;  // 1 Hz countdown refresh on Temp/Left page

/** Hardware Status → Test LCD / Test All */
static unsigned long gLcdTestUntilMs = 0;
static uint8_t gLcdTestCountLeft = 0;
static unsigned long gLcdTestTickMs = 0;
static Screen gLcdTestReturn = Screen::Start;

/** Hardware Status → Test Keypad / Test All */
static unsigned long gKeypadTestUntilMs = 0;
static uint16_t gKeypadTestMask = 0;
static uint8_t gKeypadTestLastCount = 0;
static Screen gKeypadTestReturn = Screen::Start;
static bool gKeypadTestNoTimeout = false;  // wait until all 16 keys
static bool gLcdTestHold = false;          // LCD message until cloud Done
static bool gUiSelfTestActive = false;
static bool gTestAllUi = false;
static bool gOutputTestBanner = false;
static char gOutputTestLine0[17] = "";
static char gOutputTestLine1[17] = "";
static char gLastEchoKey = 0;

static const char* ALPHA_MAP[10] = {
    " ", "ABC", "DEF", "GHI", "JKL", "MNO", "PQR", "STU", "VWX", "YZ",
};

/** Duration digits (max 6) → always "HH:MM:SS" (right-filled, empty = 00:00:00). */
static void formatDurationHms(const String& digits, char* out, size_t outSz) {
  char d[7] = {'0', '0', '0', '0', '0', '0', 0};
  int n = (int)digits.length();
  if (n > 6) n = 6;
  for (int i = 0; i < n; i++) {
    char c = digits.charAt(digits.length() - n + i);
    if (c >= '0' && c <= '9') d[6 - n + i] = c;
  }
  snprintf(out, outSz, "%c%c:%c%c:%c%c", d[0], d[1], d[2], d[3], d[4], d[5]);
}

static long durationDigitsToSeconds(const String& digits) {
  char hms[9];
  formatDurationHms(digits, hms, sizeof(hms));
  int hh = (hms[0] - '0') * 10 + (hms[1] - '0');
  int mm = (hms[3] - '0') * 10 + (hms[4] - '0');
  int ss = (hms[6] - '0') * 10 + (hms[7] - '0');
  return (long)hh * 3600L + (long)mm * 60L + (long)ss;
}

static void lcdLine(uint8_t row, const char* text) {
  if (!gLcdOk) return;
  const bool locked = uiLock();
  if (lcd.consumeRecover()) {
    // I2C missed a nibble. 4-bit mode is restored, then this line is rewritten.
  }
  lcd.setCursor(0, row > 1 ? 1 : row);
  delayMicroseconds(50);
  lcd.printPad16(text ? text : "");
  uiUnlock(locked);
}

static void lcdCentered(uint8_t row, const char* text) {
  char line[17];
  memset(line, ' ', 16);
  line[16] = 0;
  int n = (int)strlen(text);
  if (n > 16) n = 16;
  int pad = (16 - n) / 2;
  memcpy(line + pad, text, (size_t)n);
  lcdLine(row, line);
}

static void showMessage(const char* a, const char* b, unsigned long ms, Screen ret) {
  gMessageUntilMs = millis() + ms;
  gMessageReturn = ret;
  gScreen = Screen::Message;
  if (!gLcdOk) return;
  lcd.clear();
  lcdLine(0, a);
  lcdLine(1, b);
}

// Forward declarations for helpers referenced before their definitions.
static void clearTap();
static void handlePauseYes();
static void enterPausedEdit();

static bool modeIsAlphabet() {
  return gMode == InputMode::AlphabetUpper || gMode == InputMode::AlphabetLower;
}

static const char* modeName() {
  switch (gMode) {
    case InputMode::AlphabetUpper:
      return "CAPS";
    case InputMode::AlphabetLower:
      return "SMALL";
    default:
      return "NUMBER";
  }
}

static void cycleInputMode() {
  switch (gMode) {
    case InputMode::AlphabetUpper:
      gMode = InputMode::AlphabetLower;
      break;
    case InputMode::AlphabetLower:
      gMode = InputMode::Numeric;
      break;
    default:
      gMode = InputMode::AlphabetUpper;
      break;
  }
}

static void syncModeForParam() {
  if (gParamIdx != 0) gMode = InputMode::Numeric;
}

static char modeIndicator() {
  if (gParamIdx != 0) return 'N';
  switch (gMode) {
    case InputMode::AlphabetUpper:
      return 'A';
    case InputMode::AlphabetLower:
      return 'a';
    default:
      return 'N';
  }
}

static void resetParams() {
  gParamIdx = 0;
  gMode = InputMode::AlphabetUpper;
  for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i] = "";
}

static void renderStart() {
  if (!gLcdOk) return;
  lcdCentered(0, "START DRYING");
  lcdCentered(1, "SESSION!");
}

static void renderEdit() {
  if (!gLcdOk) return;
  syncModeForParam();
  char top[17];
  snprintf(top, sizeof(top), "%-15.15s", PARAM_LABELS[gParamIdx]);
  top[15] = modeIndicator();
  top[16] = 0;
  lcdLine(0, top);
  String val = gParams[gParamIdx];
  if (gParamIdx == 3) {
    // Duration always shown as 00:00:00
    char hms[9];
    formatDurationHms(val, hms, sizeof(hms));
    lcdLine(1, hms);
  } else if (gParamIdx == 2) {
    char line[17];
    if (val.length() > 15) val = val.substring(val.length() - 15);
    snprintf(line, sizeof(line), "%sC", val.c_str());
    lcdLine(1, line);
  } else {
    if (val.length() > 16) val = val.substring(val.length() - 16);
    lcdLine(1, val.c_str());
  }
}

static void renderConfirmStart() {
  if (!gLcdOk) return;
  lcdCentered(0, "START NOW?");
  // Exact layout you asked for:
  lcdLine(1, "YES(E)      NO(S)");
}

static void renderDoorWarn() {
  if (!gLcdOk) return;
  // "DOOR IS OPEN!" on 2 lines + countdown
  lcdCentered(0, "DOOR IS");
  char buf[17];
  snprintf(buf, sizeof(buf), "OPEN! %u", (unsigned)gDoorCountLeft);
  lcdCentered(1, buf);
}

static void renderContinueDoor() {
  if (!gLcdOk) return;
  lcdCentered(0, "CONTINUE?");
  lcdLine(1, "YES(E)      NO(S)");
}

static void formatRemainingHms(long remSec, char* out, size_t outSz) {
  if (remSec < 0) remSec = 0;
  long hh = remSec / 3600L;
  long mm = (remSec % 3600L) / 60L;
  long ss = remSec % 60L;
  if (hh > 99) hh = 99;
  snprintf(out, outSz, "%02ld:%02ld:%02ld", hh, mm, ss);
}

static void formatSensorLine(char* out, size_t outSz, const char* label, float value, const char* unit) {
  if (isnan(value)) {
    snprintf(out, outSz, "%s:--", label);
    return;
  }
  snprintf(out, outSz, "%s:%.1f%s", label, value, unit);
}

static void renderRunning() {
  if (!gLcdOk) return;
  static uint8_t syncedPage = 255;
  if (syncedPage != gRunPage) {
    syncedPage = gRunPage;
    lcd.needRecover = true;
  }
  char a[17], b[17];
  if (gRunPage == 0) {
    snprintf(a, sizeof(a), "Fish:%.11s", gParams[0].c_str());
    snprintf(b, sizeof(b), "Qty:%s", gParams[1].c_str());
  } else if (gRunPage == 1) {
    snprintf(a, sizeof(a), "Temp:%sC", gParams[2].c_str());
    char hms[9];
    formatRemainingHms(hmiRemainingDurationSec(), hms, sizeof(hms));
    snprintf(b, sizeof(b), "Left:%s", hms);
  } else if (gRunPage == 2) {
    formatSensorLine(a, sizeof(a), "Current", hmiLiveTemperatureC(), "C");
    formatSensorLine(b, sizeof(b), "Humidity", hmiLiveHumidity(), "%");
  } else if (gRunPage == 3 && hmiHasDryingProblem()) {
    snprintf(a, sizeof(a), "Problem:");
    char prob[17];
    hmiFormatDryingProblem(prob, sizeof(prob));
    snprintf(b, sizeof(b), "%.16s", prob);
  } else if (gRunPage == 4 && hmiDht22NotWorking()) {
    snprintf(a, sizeof(a), "Monitor the");
    snprintf(b, sizeof(b), "fish inside");
  } else {
    gRunPage = 0;
    snprintf(a, sizeof(a), "Fish:%.11s", gParams[0].c_str());
    snprintf(b, sizeof(b), "Qty:%s", gParams[1].c_str());
  }
  lcdLine(0, a);
  lcdLine(1, b);
}

static void renderStopOrPause() {
  if (!gLcdOk) return;
  // STOP left, PAUSE right — YES(E)=Pause, NO(S)=Stop+save
  lcdLine(0, "STOP        PAUSE");
  lcdLine(1, "NO(S)      YES(E)");
}

static void renderResumePrompt() {
  if (!gLcdOk) return;
  char hms[9];
  formatRemainingHms(hmiRemainingDurationSec(), hms, sizeof(hms));
  char top[17];
  const char* fish = gParams[0].length() ? gParams[0].c_str() : "PAUSED";
  snprintf(top, sizeof(top), "%-7.7s %s", fish, hms);
  lcdLine(0, top);
  lcdLine(1, "GO(E)     STOP(S)");
}

static void beginRunningUi() {
  gScreen = Screen::Running;
  gRunPage = 0;
  gRunPageMs = millis();
  gRunTickMs = millis();
  if (!gLcdOk) return;
  lcd.clear();
  renderRunning();
  Serial.println("[hmi] LCD drying details");
}

/** Idle / param-entry screens that must yield once a session is actually running. */
static bool screenYieldsToDryingDetails() {
  return gScreen == Screen::Start || gScreen == Screen::EditParams ||
         gScreen == Screen::ConfirmStart || gScreen == Screen::DoorWarn ||
         gScreen == Screen::ContinueDoor || gScreen == Screen::Message;
}

static void enterStopOrPausePrompt() {
  clearTap();
  gScreen = Screen::StopOrPause;
  renderStopOrPause();
  Serial.println("[hmi] STOP/PAUSE prompt");
}

static void actuallyStartDrying() {
  int total = gParams[1].toInt();
  float target = gParams[2].toFloat();
  long durationSec = durationDigitsToSeconds(gParams[3]);
  if (durationSec < 1) durationSec = 1;
  if (hmiSessionIsPaused()) {
    hmiOnResumeDrying(gParams[0], total, target, (int)durationSec, 1);
    beginRunningUi();
    Serial.println("[hmi] drying resumed");
    return;
  }
  hmiOnStartDrying(gParams[0], total, target, (int)durationSec, 1);
  beginRunningUi();
  Serial.println("[hmi] drying started");
}

static void enterDoorWarn() {
  // Door already closed (or no working open reading) → start now
  if (!hmiDoorIsOpen()) {
    actuallyStartDrying();
    return;
  }
  gScreen = Screen::DoorWarn;
  gDoorCountLeft = HMI_DOOR_COUNTDOWN_S;
  gDoorTickMs = millis();
  renderDoorWarn();
}

static bool validateAllParams() {
  for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i].trim();
  for (uint8_t i = 0; i < PARAM_COUNT; i++) {
    // Duration may be empty digits but still shows 00:00:00 — require > 0 time
    if (i == 3) continue;
    if (!gParams[i].length()) {
      showMessage("Fill all params", "", 1200, Screen::EditParams);
      return false;
    }
  }
  int total = gParams[1].toInt();
  float target = gParams[2].toFloat();
  long durationSec = durationDigitsToSeconds(gParams[3]);
  if (total <= 0) {
    showMessage("Qty must be > 0", "", 1200, Screen::EditParams);
    return false;
  }
  if (target < 1.f || target > 120.f) {
    showMessage("Temp 1-120 C", "", 1200, Screen::EditParams);
    return false;
  }
  if (durationSec < 1) {
    showMessage("Set Duration", "", 1200, Screen::EditParams);
    return false;
  }
  return true;
}

static int keypadTestIndex(char key);
static void handleKey(char key);

static uint8_t keypadTestPressedCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < 16; i++) {
    if (gKeypadTestMask & (1u << i)) n++;
  }
  return n;
}

static int keypadTestIndex(char key) {
  for (int i = 0; i < 16; i++) {
    if (KEYPAD_TEST_KEYS[i] == key) return i;
  }
  return -1;
}

static void renderLcdSelfTest() {
  if (!gLcdOk) return;
  lcdCentered(0, "LCD IS WORKING!");
  lcdCentered(1, "");
}

static void renderKeypadSelfTest() {
  if (!gLcdOk) return;
  char top[17];
  if (gLastEchoKey) {
    snprintf(top, sizeof(top), "KEY: %c", gLastEchoKey);
  } else {
    snprintf(top, sizeof(top), "PRESS A KEY");
  }
  lcdCentered(0, top);
  char buf[17];
  snprintf(buf, sizeof(buf), "%u/16 PRESSED", (unsigned)keypadTestPressedCount());
  lcdCentered(1, buf);
}

static void redraw() {
  if (!gReady || !gLcdOk) return;
  if (gScreen == Screen::Start) renderStart();
  else if (gScreen == Screen::EditParams) renderEdit();
  else if (gScreen == Screen::ConfirmStart) renderConfirmStart();
  else if (gScreen == Screen::DoorWarn) renderDoorWarn();
  else if (gScreen == Screen::ContinueDoor) renderContinueDoor();
  else if (gScreen == Screen::Running) renderRunning();
  else if (gScreen == Screen::StopOrPause) renderStopOrPause();
  else if (gScreen == Screen::ResumePrompt) renderResumePrompt();
  else if (gScreen == Screen::LcdSelfTest) renderLcdSelfTest();
  else if (gScreen == Screen::KeypadSelfTest) renderKeypadSelfTest();
}

/** Parameter entry only — sensor scans stay off so a key paints on this loop. */
inline bool isTypingParams() {
  if (gUiSelfTestActive) return false;
  return gReady && gScreen == Screen::EditParams;
}

inline bool isEnteringParams() {
  // A hardware test must leave the parameter screen. Quiet mode would block it.
  if (gUiSelfTestActive) return false;
  // Quiet while typing OR on STOP|PAUSE / short messages — keeps keys snappy.
  // Running sessions still heartbeats so the app stays Online.
  return gReady && (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart ||
                    gScreen == Screen::DoorWarn || gScreen == Screen::ContinueDoor ||
                    gScreen == Screen::StopOrPause || gScreen == Screen::Message);
}

inline bool blockNetworkForKey() {
  // Hardware tests must still see RTDB (Done / heartbeat). Do not freeze HTTPS.
  if (gUiSelfTestActive) return false;
  return gLastKeypressMs != 0 && (millis() - gLastKeypressMs) < 1200UL;
}

inline bool wantsNetworkQuiet() {
  // Also give the keypad a short priority window right after any press so
  // the very first Enter / typed character is not lost to HTTPS polling.
  return isEnteringParams() || blockNetworkForKey();
}

inline bool keySettledForSync() {
  return gLastKeypressMs == 0 || (millis() - gLastKeypressMs) >= 350UL;
}

/** History upload is OK on Message/Start; never during typing or STOP|PAUSE. */
inline bool canFlushOfflineHistory() {
  return !(gReady && (gScreen == Screen::ConfirmStart ||
                      gScreen == Screen::StopOrPause));
}

inline bool uiSelfTestActive() { return gUiSelfTestActive; }

inline uint8_t keypadSelfTestCount() { return keypadTestPressedCount(); }

inline uint16_t keypadSelfTestMask() { return gKeypadTestMask; }

inline String keypadSelfTestKeysCsv() {
  String out;
  out.reserve(32);
  for (uint8_t i = 0; i < 16; i++) {
    if (gKeypadTestMask & (1u << i)) {
      if (out.length()) out += ',';
      out += KEYPAD_TEST_KEYS[i];
    }
  }
  return out;
}

static void renderTestAllUi() {
  if (!gLcdOk) return;
  lcdLine(0, "LCD IS WORKING!");
  char b[17];
  snprintf(b, sizeof(b), "KEY %u/16", (unsigned)keypadTestPressedCount());
  lcdLine(1, b);
}

inline void endUiSelfTest() {
  if (!gUiSelfTestActive && !gOutputTestBanner) return;
  gUiSelfTestActive = false;
  gOutputTestBanner = false;
  gOutputTestLine0[0] = 0;
  gOutputTestLine1[0] = 0;
  gTestAllUi = false;
  gLcdTestUntilMs = 0;
  gKeypadTestUntilMs = 0;
  gKeypadTestNoTimeout = false;
  gLcdTestHold = false;
  keypad.setDebounceTime(50);
  const Screen ret =
      (gScreen == Screen::LcdSelfTest)     ? gLcdTestReturn
      : (gScreen == Screen::KeypadSelfTest) ? gKeypadTestReturn
                                            : Screen::Start;
  gScreen = ret;
  if (gScreen == Screen::Start) resetParams();
  redraw();
}

/** Show "LCD IS WORKING!" until Done (endUiSelfTest). */
inline void startLcdSelfTest(unsigned long /*durationMs*/ = 0) {
  if (!gReady) return;
  if (gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest) {
    gLcdTestReturn = gScreen;
  }
  gUiSelfTestActive = true;
  gKeypadTestNoTimeout = false;
  gKeypadTestUntilMs = 0;
  gLcdTestHold = true;
  gLcdTestUntilMs = 0;
  gLcdTestCountLeft = 0;
  gLcdTestTickMs = millis();
  gScreen = Screen::LcdSelfTest;
  if (gLcdOk) {
    lcd.clear();
    renderLcdSelfTest();
    delay(20);
    renderLcdSelfTest();
  }
  Serial.println("[hmi] LCD self-test — stays until Done");
}

/** Keypad test until Done (endUiSelfTest). */
inline void startKeypadSelfTest(unsigned long /*durationMs*/ = 0) {
  if (!gReady) return;
  if (gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest) {
    gKeypadTestReturn = gScreen;
  }
  gUiSelfTestActive = true;
  gKeypadTestMask = 0;
  gKeypadTestLastCount = 0;
  gLastEchoKey = 0;
  gKeypadTestNoTimeout = true;
  gKeypadTestUntilMs = 0;
  gScreen = Screen::KeypadSelfTest;
  // Faster debounce during test — 50ms was dropping quick taps.
  keypad.setDebounceTime(20);
  keypad.setHoldTime(200);
  if (gLcdOk) {
    lcd.clear();
    renderKeypadSelfTest();
    delay(20);
    renderKeypadSelfTest();
  }
  (void)keypad.getKeys();
  Serial.println("[hmi] Keypad self-test started — press ALL buttons (no countdown)");
}

/** Re-paint current self-test screen (call from main loop so message stays visible). */
inline void paintUiSelfTest() {
  if (!gUiSelfTestActive || !gLcdOk) return;
  if (gOutputTestBanner) {
    lcdCentered(0, gOutputTestLine0);
    lcdCentered(1, gOutputTestLine1);
    return;
  }
  if (gTestAllUi) {
    renderTestAllUi();
    return;
  }
  if (gScreen == Screen::LcdSelfTest) renderLcdSelfTest();
  else if (gScreen == Screen::KeypadSelfTest) renderKeypadSelfTest();
}

/** Leave Fish Name / parameter entry so a hardware test can own the LCD. */
inline void showHardwareTestBanner(const char* line0, const char* line1) {
  if (!gReady) return;
  if (gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest) {
    gLcdTestReturn = gScreen;
  }
  gUiSelfTestActive = true;
  gTestAllUi = false;
  gKeypadTestNoTimeout = false;
  gOutputTestBanner = true;
  snprintf(gOutputTestLine0, sizeof(gOutputTestLine0), "%s", line0 ? line0 : "");
  snprintf(gOutputTestLine1, sizeof(gOutputTestLine1), "%s", line1 ? line1 : "");
  gLcdTestHold = true;
  gScreen = Screen::LcdSelfTest;
  if (gLcdOk) {
    lcd.clear();
    paintUiSelfTest();
  }
}

static void echoPressedOnLcd(char key) {
  gLastEchoKey = key;
  if (!gLcdOk) return;
  if (gTestAllUi) {
    renderTestAllUi();
    return;
  }
  if (gScreen == Screen::KeypadSelfTest) {
    renderKeypadSelfTest();
  }
}

static bool registerKeypadTestKey(char key) {
  const int idx = keypadTestIndex(key);
  if (idx < 0) return false;
  const uint16_t bit = (uint16_t)(1u << idx);
  if (gKeypadTestMask & bit) return false;
  gKeypadTestMask |= bit;
  gKeypadOk = true;
  Serial.printf("[hmi] keypad test %u/16 key=%c\n",
                (unsigned)keypadTestPressedCount(), key);
  return true;
}

/** True while waiting for the user to finish the keypad (no auto timeout). */
inline bool keypadSelfTestWaiting() {
  return gUiSelfTestActive && gScreen == Screen::KeypadSelfTest && gKeypadTestNoTimeout;
}

inline bool keypadSelfTestActiveScreen() {
  return gScreen == Screen::KeypadSelfTest || gTestAllUi;
}

/**
 * Direct matrix read. The Keypad library only reports a key on a later scan,
 * so the LCD character showed up on the next click. One stable press = one character now.
 */
static uint16_t gKeyStableMask = 0;
static volatile uint8_t gKeyQ[16];
static volatile uint8_t gKeyQHead = 0;
static volatile uint8_t gKeyQTail = 0;
static TaskHandle_t gKeyTask = nullptr;
static uint16_t sampleKeyMask();

static void keypadEnqueue(char ch) {
  const uint8_t next = (uint8_t)((gKeyQHead + 1u) % 16u);
  if (next == gKeyQTail) return;
  gKeyQ[gKeyQHead] = (uint8_t)ch;
  gKeyQHead = next;
}

static void dispatchKeyChar(char ch);
/** Letters and digits paint here, on the scan task, so HTTPS cannot delay the LCD. */
static bool keyPaintsImmediately(char ch) {
  if (gUiSelfTestActive && gScreen != Screen::KeypadSelfTest && !gTestAllUi) return false;
  if (gScreen == Screen::KeypadSelfTest || gTestAllUi) return true;
  if (gScreen == Screen::LcdSelfTest && gKeypadTestNoTimeout) return true;
  if (gScreen != Screen::EditParams) return false;
  if (ch == '#' || ch == 'D') return false;
  return true;
}

static void acceptKey(char ch) {
  if (!keyPaintsImmediately(ch)) {
    keypadEnqueue(ch);
    return;
  }
  const bool locked = uiLock();
  dispatchKeyChar(ch);
  uiUnlock(locked);
}

static void keypadSampleTask(void*) {
  uint16_t stable = 0;
  for (;;) {
    uint16_t raw = sampleKeyMask();
    if (raw != stable) {
      delayMicroseconds(150);
      if (sampleKeyMask() == raw) {
        const uint16_t rose = (uint16_t)(raw & ~stable);
        stable = raw;
        for (uint8_t i = 0; i < 16; i++) {
          if (rose & (uint16_t)(1u << i)) acceptKey(KEYPAD_TEST_KEYS[i]);
        }
      }
    } else {
      stable = raw;
    }
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

static uint16_t sampleKeyMask() {
  uint16_t mask = 0;
  for (byte r = 0; r < ROWS; r++) pinMode(rowPins[r], INPUT_PULLUP);
  for (byte c = 0; c < COLS; c++) {
    pinMode(colPins[c], OUTPUT);
    digitalWrite(colPins[c], LOW);
    delayMicroseconds(15);
    for (byte r = 0; r < ROWS; r++) {
      if (digitalRead(rowPins[r]) == LOW) {
        const int idx = keypadTestIndex(keys[r][c]);
        if (idx >= 0) mask |= (uint16_t)(1u << idx);
      }
    }
    digitalWrite(colPins[c], HIGH);
    pinMode(colPins[c], INPUT);
  }
  return mask;
}

static void dispatchKeyChar(char ch) {
  if (keypadSelfTestActiveScreen()) {
    registerKeypadTestKey(ch);
    echoPressedOnLcd(ch);
  } else {
    handleKey(ch);
  }
}

inline bool keyQueued() { return gKeyQHead != gKeyQTail; }

inline void pollKeypadFast() {
  if (!gReady) return;
  if (gKeyTask) {
    while (gKeyQTail != gKeyQHead) {
      const char ch = (char)gKeyQ[gKeyQTail];
      gKeyQTail = (uint8_t)((gKeyQTail + 1u) % 16u);
      const bool locked = uiLock();
      dispatchKeyChar(ch);
      uiUnlock(locked);
    }
    return;
  }
  uint16_t raw = sampleKeyMask();
  if (raw != gKeyStableMask) {
    delayMicroseconds(300);
    const uint16_t again = sampleKeyMask();
    if (again != raw) return;
  }
  if (raw == gKeyStableMask) return;
  const uint16_t rose = (uint16_t)(raw & ~gKeyStableMask);
  gKeyStableMask = raw;
  if (!rose) return;
  for (uint8_t i = 0; i < 16; i++) {
    if ((rose & (uint16_t)(1u << i)) == 0) continue;
    dispatchKeyChar(KEYPAD_TEST_KEYS[i]);
  }
}

/** Test All: hold "LCD IS WORKING!" and collect keypad presses until Done. */
inline void startTestAllUi() {
  startLcdSelfTest(0);
  gTestAllUi = true;
  gKeypadTestMask = 0;
  gKeypadTestLastCount = 0;
  gLastEchoKey = 0;
  gKeypadTestNoTimeout = true;
  gKeypadTestUntilMs = 0;
  gKeypadTestReturn = gLcdTestReturn;
  renderTestAllUi();
}

inline void startCombinedUiSelfTest(unsigned long /*totalMs*/ = 0) {
  startTestAllUi();
}

static void clearTap() {
  gTapKey = 0;
  gTapPos = 0;
  gTapMs = 0;
}

static void commitTapIfNeeded() {
  if (gTapKey && (millis() - gTapMs) > HMI_MULTITAP_MS) clearTap();
}

static void appendChar(char c) {
  if (gParamIdx == 3) {
    // Duration: digits only, max 6 → displayed as HH:MM:SS
    if (c < '0' || c > '9') return;
    if (gParams[3].length() >= 6) return;
    gParams[3] += c;
    return;
  }
  if (gParams[gParamIdx].length() >= 32) return;
  gParams[gParamIdx] += c;
}

static void backspace() {
  clearTap();
  if (gParams[gParamIdx].length()) gParams[gParamIdx].remove(gParams[gParamIdx].length() - 1);
}

static void phoneMultiTap(char digitChar) {
  int d = digitChar - '0';
  if (d < 1 || d > 9) return;
  const char* L = ALPHA_MAP[d];
  uint8_t n = (uint8_t)strlen(L);
  if (!n) return;

  String& s = gParams[gParamIdx];
  unsigned long now = millis();

  if (gTapKey == digitChar && (now - gTapMs) <= HMI_MULTITAP_MS) {
    gTapPos = (gTapPos + 1) % n;
    char ch = L[gTapPos];
    if (gMode == InputMode::AlphabetLower && ch >= 'A' && ch <= 'Z') ch = (char)(ch + 32);
    if (s.length()) s.setCharAt(s.length() - 1, ch);
    else s += ch;
  } else {
    gTapKey = digitChar;
    gTapPos = 0;
    char ch = L[0];
    if (gMode == InputMode::AlphabetLower && ch >= 'A' && ch <= 'Z') ch = (char)(ch + 32);
    appendChar(ch);
  }
  gTapMs = now;
}

static void goNextParam() {
  clearTap();
  if (gParamIdx + 1 < PARAM_COUNT) {
    gParamIdx++;
    syncModeForParam();
  }
}

static void goPrevParam() {
  clearTap();
  if (gParamIdx > 0) {
    gParamIdx--;
    // Fish Name keeps last N/A/a choice; other params stay N.
  }
}

static void handleEnter() {
  clearTap();
  if (gScreen == Screen::Start) {
    gScreen = Screen::EditParams;
    gParamIdx = 0;
    gMode = InputMode::AlphabetUpper;  // Fish Name starts on capital letters
    for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i] = "";
    Serial.println("[hmi] -> Fish Name: (CAPS)");
    redraw();
    return;
  }
  if (gScreen == Screen::ConfirmStart) {
    enterDoorWarn();
    return;
  }
  if (gScreen == Screen::ContinueDoor) {
    actuallyStartDrying();
    return;
  }
  if (gScreen == Screen::StopOrPause) {
    handlePauseYes();
    return;
  }
  if (gScreen == Screen::DoorWarn) return;
  if (gScreen == Screen::Running) {
    if (hmiSessionIsPaused()) enterPausedEdit();
    return;
  }
  if (gScreen != Screen::EditParams) return;

  String cur = gParams[gParamIdx];
  cur.trim();
  if (gParamIdx != 3 && !cur.length()) {
    showMessage("Enter a value", "", 1000, Screen::EditParams);
    return;
  }
  if (gParamIdx != 3) gParams[gParamIdx] = cur;
  if (gParamIdx + 1 < PARAM_COUNT) {
    gParamIdx++;
    syncModeForParam();
    redraw();
    return;
  }
  if (!validateAllParams()) return;
  if (hmiSessionIsPaused()) {
    enterDoorWarn();
    return;
  }
  gScreen = Screen::ConfirmStart;
  redraw();
}

static void handleStopOrNo() {
  clearTap();
  // NO(S) on confirm / continue / door — do not start
  if (gScreen == Screen::ConfirmStart || gScreen == Screen::ContinueDoor ||
      gScreen == Screen::DoorWarn) {
    gScreen = Screen::EditParams;
    gParamIdx = PARAM_COUNT - 1;
    syncModeForParam();
    redraw();
    Serial.println("[hmi] NO — cancelled start");
    return;
  }
  // Stop/Pause prompt: NO(S) = STOP and save history / queue if offline
  if (gScreen == Screen::StopOrPause) {
    hmiOnStopDrying();
    resetParams();
    showMessage("Stopped/Saved", "", 1500, Screen::Start);
    return;
  }
  // During drying (local or app): ask STOP vs PAUSE
  if (gScreen == Screen::Running || hmiSessionIsRunning() || hmiSessionIsPaused()) {
    enterStopOrPausePrompt();
  }
}

static void enterPausedEdit() {
  long rem = hmiRemainingDurationSec();
  if (rem < 1) rem = durationDigitsToSeconds(gParams[3]);
  if (rem < 1) rem = 1;
  long hh = rem / 3600L;
  long mm = (rem % 3600L) / 60L;
  long ss = rem % 60L;
  char dbuf[12];
  snprintf(dbuf, sizeof(dbuf), "%02ld%02ld%02ld", hh > 99 ? 99 : hh, mm, ss);
  gParams[3] = String(dbuf);
  gParamIdx = 0;
  gScreen = Screen::EditParams;
  syncModeForParam();
  redraw();
  Serial.println("[hmi] paused — edit parameters");
}

static void handlePauseYes() {
  clearTap();
  if (gScreen != Screen::StopOrPause) return;
  hmiOnPauseDrying();
}

static void handleFinished() {
  clearTap();
  hmiOnDurationComplete();
  resetParams();
  showMessage("Finished/Saved", "", 2000, Screen::Start);
}

static void handleKey(char key) {
  gLastKeypressMs = millis();
  gKeypadOk = true;

  // During keypad test OR combined LCD→keypad wait: count every raw key.
  if (gScreen == Screen::KeypadSelfTest ||
      (gScreen == Screen::LcdSelfTest && gKeypadTestNoTimeout)) {
    registerKeypadTestKey(key);
    echoPressedOnLcd(key);
    return;
  }
  if (gScreen == Screen::LcdSelfTest) {
    return;
  }

  // Plug pulled mid-dry: this screen is the paused session. Enter continues, Stop saves.
  if (gScreen == Screen::ResumePrompt) {
    if (key == '#') {
      if (hmiDoorIsOpen()) enterDoorWarn();
      else actuallyStartDrying();
      return;
    }
    if (key == 'D') {
      hmiOnStopDrying();
      resetParams();
      showMessage("Stopped/Saved", "", 1500, Screen::Start);
      return;
    }
    return;
  }

  if (key == 'A') {
    if (gScreen == Screen::EditParams && gParamIdx == 0) {
      clearTap();
      cycleInputMode();
      Serial.printf("[hmi] mode=%s (%c)\n", modeName(), modeIndicator());
      redraw();
    }
    return;
  }
  if (key == 'B') {
    if (gScreen == Screen::EditParams) {
      goPrevParam();
      redraw();
    }
    return;
  }
  if (key == 'C') {
    if (gScreen == Screen::EditParams) {
      goNextParam();
      redraw();
    }
    return;
  }
  if (key == 'D') {
    handleStopOrNo();
    return;
  }
  // Enter = raw '#' (3rd bottom). On START only, raw '0' also Enter
  // so one press opens Fish Name (no random key mashing).
  if (key == '#') {
    handleEnter();
    return;
  }
  if (key == '0') {
    if (gScreen == Screen::Start) {
      handleEnter();
      return;
    }
    if (gScreen == Screen::EditParams) {
      backspace();
      redraw();
    }
    return;
  }

  // Start screen: only Enter proceeds — ignore other keys
  if (gScreen == Screen::Start) {
    return;
  }
  if (gScreen == Screen::ConfirmStart || gScreen == Screen::ContinueDoor ||
      gScreen == Screen::DoorWarn || gScreen == Screen::Running ||
      gScreen == Screen::StopOrPause || gScreen == Screen::Message) {
    return;
  }
  if (gScreen != Screen::EditParams) return;

  if (key == '*') {
    clearTap();
    appendChar(modeIsAlphabet() ? ' ' : '0');
    redraw();
    return;
  }

  if (key >= '1' && key <= '9') {
    if (modeIsAlphabet()) {
      phoneMultiTap(key);
    } else {
      clearTap();
      appendChar(key);
    }
    redraw();
  }
}

inline void begin() {
#if defined(ESP32)
  if (!gUiMutex) gUiMutex = xSemaphoreCreateRecursiveMutex();
#endif
  Serial.println("[hmi] === LOCAL HMI READY ===");
  Serial.println("[hmi] boot: START DRYING SESSION -> Enter -> Fish Name (CAPS / SMALL / NUMBER)");
  pinMode(PIN_LCD_SDA, INPUT_PULLUP);
  pinMode(PIN_LCD_SCL, INPUT_PULLUP);
  delay(50);
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  Wire.setClock(100000);
  delay(200);

  gLcdOk = false;
  uint8_t found[8];
  uint8_t nFound = 0;
  Serial.println("[hmi] I2C scan...");
  for (uint8_t a = 0x20; a <= 0x27; a++) {
    if (lcd.ping(a) && nFound < 8) found[nFound++] = a;
  }
  for (uint8_t a = 0x38; a <= 0x3F; a++) {
    if (lcd.ping(a) && nFound < 8) found[nFound++] = a;
  }
  if (nFound == 0) {
    Serial.println("[hmi] I2C scan empty — still trying 0x27 and 0x3F");
    found[nFound++] = 0x27;
    found[nFound++] = 0x3F;
  }
  for (uint8_t i = 0; i < nFound; i++) {
    Serial.printf("[hmi] LCD init @0x%02X SDA=%d SCL=%d\n", found[i], PIN_LCD_SDA, PIN_LCD_SCL);
    lcd.begin(found[i]);
    gLcdOk = true;
    lcd.clear();
    lcdCentered(0, "START DRYING");
    lcdCentered(1, "SESSION!");
    delay(80);
    lcdCentered(0, "START DRYING");
    lcdCentered(1, "SESSION!");
    Serial.printf("[hmi] LCD @0x%02X\n", found[i]);
    break;
  }

  keypad.setDebounceTime(20);
  keypad.setHoldTime(400);

  if (gKeyTask == nullptr) {
    xTaskCreatePinnedToCore(keypadSampleTask, "keypad", 2048, nullptr, 3, &gKeyTask, 0);
  }

  gKeypadOk = true;
  gReady = true;
  gScreen = Screen::Start;
  resetParams();
  gMode = InputMode::AlphabetUpper;
  if (gLcdOk) {
    lcd.clear();
    renderStart();
    delay(50);
    renderStart();  // second paint — some I2C LCDs miss the first
  }
}

inline bool lcdWorking() { return gLcdOk; }
inline bool keypadWorking() { return gKeypadOk; }

inline void poll() {
  if (!gReady) return;
  commitTapIfNeeded();

  if (gScreen == Screen::Message && (long)(millis() - gMessageUntilMs) >= 0) {
    if (hmiSessionIsRunning()) {
      beginRunningUi();
    } else {
      gScreen = gMessageReturn;
      if (gScreen == Screen::Start) resetParams();
      if (gLcdOk && gScreen == Screen::Start) {
        lcd.clear();
        renderStart();
      } else {
        redraw();
      }
    }
  }

  // Keypad start and app start both land here: if the session is running,
  // replace START / param entry with fish, qty, target, and time left.
  if (hmiSessionIsRunning() && screenYieldsToDryingDetails() &&
      gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest &&
      gScreen != Screen::StopOrPause) {
    beginRunningUi();
  }

  // LCD self-test stays on until the app taps Done (endUiSelfTest).
  if (gScreen == Screen::LcdSelfTest) {
    gLcdTestHold = true;
    paintUiSelfTest();
  }

  // Keypad self-test: no timeout when gKeypadTestNoTimeout — finish at 16/16 only.
  if (gScreen == Screen::KeypadSelfTest) {
    static bool sLoggedComplete = false;
    if (keypadTestPressedCount() >= 16) {
      if (!sLoggedComplete) {
        sLoggedComplete = true;
        Serial.println("[hmi] keypad test 16/16 — waiting for Done");
        if (gLcdOk) {
          lcd.clear();
          lcdCentered(0, "KEYPAD OK!");
          lcdCentered(1, "TAP DONE");
        }
      }
    } else {
      sLoggedComplete = false;
    }
  }

  // Door open warn: auto-start if door closes; else countdown → CONTINUE?
  if (gScreen == Screen::DoorWarn) {
    if (!hmiDoorIsOpen()) {
      actuallyStartDrying();
    } else if (millis() - gDoorTickMs >= 1000UL) {
      gDoorTickMs = millis();
      if (gDoorCountLeft > 0) gDoorCountLeft--;
      if (gDoorCountLeft == 0) {
        gScreen = Screen::ContinueDoor;
        renderContinueDoor();
      } else {
        renderDoorWarn();
      }
    }
  }

  // Fish/Qty → Temp/Left → Current/Humidity → Problem (if any) → DHT22 warning (if sensor is dead).
  if (gScreen == Screen::Running && (hmiSessionIsRunning() || hmiSessionIsPaused())) {
    if (hmiSessionIsRunning() && hmiLocalDurationExpired()) {
      handleFinished();
    } else if (gRunPage == 3 && !hmiHasDryingProblem()) {
      gRunPage = hmiDht22NotWorking() ? 4 : 0;
      gRunPageMs = millis();
      gRunTickMs = millis();
      renderRunning();
    } else if (gRunPage == 4 && !hmiDht22NotWorking()) {
      gRunPage = 0;
      gRunPageMs = millis();
      gRunTickMs = millis();
      renderRunning();
    } else if (millis() - gRunPageMs >= HMI_PARAM_ROTATE_MS) {
      gRunPageMs = millis();
      uint8_t next = (uint8_t)(gRunPage + 1);
      if (next == 3 && !hmiHasDryingProblem()) next = 4;
      if (next == 4 && !hmiDht22NotWorking()) next = 0;
      if (next > 4) next = 0;
      gRunPage = next;
      gRunTickMs = millis();
      renderRunning();
    } else if ((gRunPage == 1 || gRunPage == 2) && hmiSessionIsRunning() &&
               (millis() - gRunTickMs >= 1000UL)) {
      gRunTickMs = millis();
      renderRunning();
    }
  } else if (gScreen == Screen::Running && !hmiSessionIsRunning() &&
             !hmiSessionIsPaused()) {
    // External stop (app / cloud)
    resetParams();
    gScreen = Screen::Start;
    redraw();
  }

  // Always drain keypad — especially critical during self-test.
  pollKeypadFast();
}

/**
 * Dedicated keypad-test service: call from loop while waiting for all buttons.
 * Returns false if test ended (complete / cancelled / not in keypad test).
 */
inline bool serviceKeypadSelfTestSlice() {
  if (!keypadSelfTestWaiting()) return false;
  poll();
  return keypadSelfTestWaiting();
}

/** App or keypad session is running — remember details and show them on the LCD. */
inline void adoptCloudSession(const String& fishType, int totalFish, float targetC,
                              int durationSec) {
  if (!gReady) return;
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest) return;
  if (fishType.length() > 0) gParams[0] = fishType;
  if (totalFish >= 0) gParams[1] = String(totalFish);
  if (targetC > 1.0f && targetC < 120.0f) {
    char tbuf[12];
    snprintf(tbuf, sizeof(tbuf), "%.0f", targetC);
    gParams[2] = String(tbuf);
  }
  if (durationSec > 0) {
    long sec = durationSec;
    long hh = sec / 3600L;
    long mm = (sec % 3600L) / 60L;
    long ss = sec % 60L;
    if (hh > 99) hh = 99;
    char dbuf[12];
    snprintf(dbuf, sizeof(dbuf), "%02ld%02ld%02ld", hh, mm, ss);
    gParams[3] = String(dbuf);
  }
  // STOP/PAUSE prompt stays up; details are already stored for when it closes.
  if (gScreen == Screen::StopOrPause) return;
  if (gScreen == Screen::Running) {
    renderRunning();
    return;
  }
  beginRunningUi();
}

inline void adoptCloudPaused() {
  if (!gReady) return;
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest) return;
  if (gScreen == Screen::ResumePrompt) return;
  if (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart ||
      gScreen == Screen::DoorWarn || gScreen == Screen::ContinueDoor) {
    return;
  }
  enterPausedEdit();
}

inline void showInterruptedSession(const String& fish, int qty, float targetC, long remainingSec) {
  if (!gReady) return;
  gParams[0] = fish;
  gParams[1] = String(qty < 0 ? 0 : qty);
  char tbuf[12];
  snprintf(tbuf, sizeof(tbuf), "%.0f", (targetC > 1.0f && targetC < 120.0f) ? targetC : 60.0f);
  gParams[2] = String(tbuf);
  if (remainingSec < 0) remainingSec = 0;
  long hh = remainingSec / 3600L;
  long mm = (remainingSec % 3600L) / 60L;
  long ss = remainingSec % 60L;
  if (hh > 99) hh = 99;
  char dbuf[12];
  snprintf(dbuf, sizeof(dbuf), "%02ld%02ld%02ld", hh, mm, ss);
  gParams[3] = String(dbuf);
  gScreen = Screen::ResumePrompt;
  redraw();
  Serial.println("[hmi] power resume — PAUSED, GO or STOP");
}

inline void enterPausedEditUi() {
  if (!gReady) return;
  enterPausedEdit();
}

inline void adoptCloudStopped() {
  if (!gReady) return;
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest) return;
  if (gScreen == Screen::Message) return;
  if (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart) return;
  resetParams();
  gScreen = Screen::Start;
  if (gLcdOk) {
    lcd.clear();
    renderStart();
  }
}

}  // namespace LocalHmi

#else

namespace LocalHmi {
inline void begin() {}
inline void poll() {}
inline bool lcdWorking() { return false; }
inline bool keypadWorking() { return false; }
inline bool keyQueued() { return false; }
inline bool isTypingParams() { return false; }
inline bool isEnteringParams() { return false; }
inline bool blockNetworkForKey() { return false; }
inline bool wantsNetworkQuiet() { return false; }
inline bool keySettledForSync() { return true; }
inline bool canFlushOfflineHistory() { return true; }
inline bool uiSelfTestActive() { return false; }
inline uint8_t keypadSelfTestCount() { return 0; }
inline uint16_t keypadSelfTestMask() { return 0; }
inline String keypadSelfTestKeysCsv() { return String(); }
inline void endUiSelfTest() {}
inline void startLcdSelfTest(unsigned long = 0) {}
inline void startKeypadSelfTest(unsigned long = 0) {}
inline void startCombinedUiSelfTest(unsigned long = 0) {}
inline void startTestAllUi() {}
inline void paintUiSelfTest() {}
inline bool keypadSelfTestWaiting() { return false; }
inline void pollKeypadFast() {}
inline bool serviceKeypadSelfTestSlice() { return false; }
inline void adoptCloudSession(const String&, int, float, int) {}
inline void adoptCloudPaused() {}
inline void adoptCloudStopped() {}
inline void enterPausedEditUi() {}
inline void showInterruptedSession(const String&, int, float, long) {}
}

#endif
