#ifndef Pen_h
#define Pen_h
#include <ESP32Servo.h>
#include <Preferences.h>
const int DEFAULT_LIFT_AMOUNT = 20;
class Pen {
    private:
    Servo *servo;
    Preferences preferences;
    bool inverted;
    int liftAmount;
    int penDistance = -1;
    int cachedSavedPenDistance;
    int slowSpeedDegPerSec = 90;
    int currentPosition = 90;
    int applyInversion(int angle);
    int getUpPosition();
    public:
    Pen();
    void setRawValue(int rawValue);
    void setPenDistance(int value);
    void slowUp();
    void slowDown();
    bool isDown();
    void setInverted(bool inverted);
    bool isInverted();
    void setLiftAmount(int amount);
    int getLiftAmount();
    bool isCalibrated();
    int getSavedPenDistance();
    void restorePenDistance();
};
#endif