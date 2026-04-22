#ifndef CommandHandlingPhase_h
#define CommandHandlingPhase_h
#include "notsupportedphase.h"
#include "phasemanager.h"
class CommandHandlingPhase : public NotSupportedPhase {
    private:
    PhaseManager* manager;
    Movement* movement;
    public:
    CommandHandlingPhase(PhaseManager* manager, Movement* movement);
    void handleCommand(AsyncWebServerRequest *request);
};
#endif