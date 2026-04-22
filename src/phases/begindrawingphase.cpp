#include "begindrawingphase.h"
BeginDrawingPhase::BeginDrawingPhase(PhaseManager* manager, Runner* runner) {
    this->manager = manager;
    this->runner = runner;
}

void BeginDrawingPhase::run(AsyncWebServerRequest *request) {
    runner->start();
    manager->respondWithState(request);
}

void BeginDrawingPhase::doneWithPhase(AsyncWebServerRequest *request) {
    manager->reset();
    manager->respondWithState(request);
}

const char* BeginDrawingPhase::getName() {
    return "BeginDrawing";
}