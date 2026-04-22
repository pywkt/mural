#ifndef PhaseManager_H
#define PhaseManager_H
#include "phase.h"
#include "movement.h"
#include "pen.h"
#include "runner.h"
#include "ArduinoJson.h"
class PhaseManager {
    private:
    Phase* currentPhase;
    Phase* retractBeltsPhase;
    Phase* setTopDistancePhase;
    Phase* extendToHomePhase;
    Phase* penCalibrationPhase;
    Phase* svgSelectPhase;
    Phase* beginDrawingPhase;
    Movement* movement;
    Pen* pen;
    Runner* runner;
    public:
    enum PhaseNames {RetractBelts, SetTopDistance, ExtendToHome, PenCalibration, SvgSelect, BeginDrawing};
    PhaseManager(Movement* movement, Pen* pen, Runner* runner);
    Phase* getCurrentPhase();
    void setPhase(PhaseNames name);
    void buildStateJson(JsonObject& root);
    void respondWithState(AsyncWebServerRequest *request);
    void reset();
    bool setPhaseByName(const String& name);
};
#endif