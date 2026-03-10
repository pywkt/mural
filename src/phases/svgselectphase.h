#ifndef SvgSelectPhase_h
#define SvgSelectPhase_h
#include "notsupportedphase.h"
#include "phasemanager.h"
#include "movement.h"
#include "pen.h"
class SvgSelectPhase : public NotSupportedPhase {
    private:
    PhaseManager* manager;
    Movement* movement;
    Pen* pen;
    public:
    SvgSelectPhase(PhaseManager* manager, Movement* movement, Pen* pen);
    void handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final);
    const char* getName();
};
#endif