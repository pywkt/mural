#include "settopdistancephase.h"
#include "commandhandlingphase.h"
SetTopDistancePhase::SetTopDistancePhase(PhaseManager* manager, Movement* movement, Pen* pen) : CommandHandlingPhase(manager, movement) {
    this->manager = manager;
    this->movement = movement;
    this->pen = pen;
}

void SetTopDistancePhase::setTopDistance(AsyncWebServerRequest *request) {
    const AsyncWebParameter* p = request->getParam(0);
    int distance = p->value().toInt();
    Serial.println("Setting distance");
    movement->setTopDistance(distance); 
    manager->setPhase(PhaseManager::SvgSelect);
    manager->respondWithState(request);
}

void SetTopDistancePhase::resumeTopDistance(AsyncWebServerRequest *request) {
    const AsyncWebParameter* p = request->getParam(0);
    int distance = p->value().toInt();
    Serial.println("Resuming with saved distance");
    movement->resumeTopDistance(distance);
    pen->restorePenDistance();
    manager->setPhase(PhaseManager::SvgSelect);
    manager->respondWithState(request);
}

void SetTopDistancePhase::setServo(AsyncWebServerRequest *request) {
    const AsyncWebParameter* p = request->getParam(0);
    int angle = p->value().toInt();
    pen->setRawValue(angle);
    manager->respondWithState(request);
}

void SetTopDistancePhase::estepsCalibration(AsyncWebServerRequest* request) {
    Serial.println("Extending 1000mm");
    movement->extend1000mm();
    manager->respondWithState(request);
}

const char* SetTopDistancePhase::getName() {
    return "SetTopDistance";
}