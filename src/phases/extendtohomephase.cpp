#include "extendtohomephase.h"
#include "AsyncJson.h"
#include "ArduinoJson.h"

void ExtendToHomePhase::extendToHome(AsyncWebServerRequest *request) {
    auto moveTime = movement->extendToHome() + 1; // extra second of waiting for good measure
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    DynamicJsonBuffer jsonBuffer;
    JsonObject &root = jsonBuffer.createObject();
    manager->buildStateJson(root);
    root["extendTime"] = moveTime;
    root.printTo(*response);
    request->send(response);
}

ExtendToHomePhase::ExtendToHomePhase(PhaseManager* manager, Movement* movement) {
    this->manager = manager;
    this->movement = movement;
}

const char* ExtendToHomePhase::getName() {
    return "ExtendToHome";
}

void ExtendToHomePhase::loopPhase() {
    if (movement->hasStartedHoming() && !movement->isMoving()) {
        manager->setPhase(PhaseManager::PenCalibration);
    }
}