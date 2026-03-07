#ifndef Pen_h
#define Pen_h
#include <ESP32Servo.h>
#include <Preferences.h>
const int RETRACT_DISTANCE = 20;
class Pen {
    private:
    Servo *servo;
    Preferences preferences;
    bool inverted;
    int penDistance = -1;
    int slowSpeedDegPerSec = 90;
    int currentPosition = 90;
    int applyInversion(int angle);
    public:
    Pen();
    void setRawValue(int rawValue);
    void setPenDistance(int value);
    void slowUp();
    void slowDown();
    bool isDown();
    void setInverted(bool inverted);
    bool isInverted();
};
#endif