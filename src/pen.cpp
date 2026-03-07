#include "pen.h"

bool shouldStop(int currentDegree, int targetDegree, bool positive) {
    if (positive) {
        return currentDegree > targetDegree;
    } else {
        return currentDegree < targetDegree;
    }
}

void doSlowMove(Pen* pen, int startDegree, int targetDegree, int speedDegPerSec) {
    if (startDegree == targetDegree) {
        return;
    }

    auto startTime = millis();

    bool positive;
    if (targetDegree > startDegree) {
        positive = true;
    } else {
        positive = false;
    }

    auto currentDegree = startDegree;

    while (!(shouldStop(currentDegree, targetDegree, positive))) {
        pen->setRawValue(currentDegree);
        delay(10);

        auto currentTime = millis();
        auto deltaTime = currentTime - startTime;
        auto progressDegrees = int(double(deltaTime) / 1000 * speedDegPerSec);

        if (!positive) {
            progressDegrees = progressDegrees * -1;
        }

        currentDegree = startDegree + progressDegrees;
    }
    pen->setRawValue(targetDegree);
    delay(200);
}


Pen::Pen()
{
    preferences.begin("mural_pen", false);
    inverted = preferences.getBool("inverted", false);

    servo = new Servo();
    servo->attach(2);
    servo->write(applyInversion(90));
    currentPosition = 90;
}

int Pen::applyInversion(int angle) {
    return inverted ? 180 - angle : angle;
}

void Pen::setRawValue(int rawValue) {
    this->servo->write(applyInversion(rawValue));
    currentPosition = rawValue;
}

void Pen::setInverted(bool inv) {
    inverted = inv;
    preferences.putBool("inverted", inverted);
    // Re-apply current position with new inversion
    servo->write(applyInversion(currentPosition));
}

bool Pen::isInverted() {
    return inverted;
}

void Pen::setPenDistance(int value) {
    Serial.println("Pen distance angle set to " + String(value));
    this->penDistance = value;
}

void Pen::slowUp() {
    if (penDistance == -1) {
        throw std::invalid_argument("not ready");
    }

    doSlowMove(this, currentPosition, 90, slowSpeedDegPerSec);
    currentPosition = 90;
}

void Pen::slowDown() {
    if (penDistance == -1) {
        throw std::invalid_argument("not ready");
    }

    doSlowMove(this, currentPosition, penDistance, slowSpeedDegPerSec);
    currentPosition = penDistance;
}

bool Pen::isDown() {
    return currentPosition == penDistance;
}