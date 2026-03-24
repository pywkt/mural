#include "pen.h"

bool shouldStop(int currentDegree, int targetDegree, bool positive) {
    if (positive) {
        return currentDegree > targetDegree;
    } else {
        return currentDegree < targetDegree;
    }
}

void doSlowMove(Pen* pen, int startDegree, int targetDegree, int speedDegPerSec, int settleDelay) {
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
    if (settleDelay > 0) delay(settleDelay);
}


Pen::Pen()
{
    preferences.begin("mural_pen", false);
    inverted = preferences.getBool("inverted", false);
    liftAmount = preferences.getInt("liftAmt", DEFAULT_LIFT_AMOUNT);
    servoDelay = preferences.getInt("srvDelay", DEFAULT_SERVO_DELAY);
    cachedSavedPenDistance = preferences.getInt("penDist", -1);

    servo = new Servo();
    servo->attach(2);
    int startAngle = inverted ? 0 : 90;
    servo->write(applyInversion(startAngle));
    currentPosition = startAngle;
}

int Pen::getUpPosition() {
    if (penDistance == -1) {
        return 90;
    }
    if (inverted) {
        int upPos = penDistance - liftAmount;
        return max(upPos, 0);
    } else {
        int upPos = penDistance + liftAmount;
        return min(upPos, 180);
    }
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
    cachedSavedPenDistance = value;
    preferences.putInt("penDist", value);
}

bool Pen::isCalibrated() {
    return penDistance != -1;
}

int Pen::getSavedPenDistance() {
    return cachedSavedPenDistance;
}

void Pen::restorePenDistance() {
    int saved = getSavedPenDistance();
    if (saved != -1) {
        penDistance = saved;
    }
}

void Pen::slowUp() {
    if (penDistance == -1) {
        throw std::invalid_argument("not ready");
    }

    int upPos = getUpPosition();
    doSlowMove(this, currentPosition, upPos, slowSpeedDegPerSec, servoDelay);
    currentPosition = upPos;
}

void Pen::setLiftAmount(int amount) {
    liftAmount = constrain(amount, 5, 90);
    preferences.putInt("liftAmt", liftAmount);
}

int Pen::getLiftAmount() {
    return liftAmount;
}

void Pen::slowDown() {
    if (penDistance == -1) {
        throw std::invalid_argument("not ready");
    }

    doSlowMove(this, currentPosition, penDistance, slowSpeedDegPerSec, servoDelay);
    currentPosition = penDistance;
}

bool Pen::isDown() {
    return currentPosition == penDistance;
}

void Pen::setServoDelay(int ms) {
    servoDelay = constrain(ms, 0, 1000);
    preferences.putInt("srvDelay", servoDelay);
}

int Pen::getServoDelay() {
    return servoDelay;
}