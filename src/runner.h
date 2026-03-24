#ifndef Runner_h
#define Runner_h
#include "movement.h"
#include "tasks/task.h"
#include "pen.h"
#include "display.h"
#include "LittleFS.h"
class Runner {
    private:
    Movement *movement;
    Pen *pen;
    Display *display;
    void initTaskProvider();
    Task* getNextTask();
    Task* getNextGcodeTask();
    void calculateGcodeDistance();
    Task* currentTask;
    bool stopped;
    File openedFile;
    double totalDistance;
    double distanceSoFar;
    Movement::Point startPosition;
    Movement::Point targetPosition;
    int progress;
    Task *finishingSequence[2];
    int sequenceIx = 0;
    bool isGcode;
    bool gcPenDown;
    Task* pendingTask;
    double lastGcX;
    double lastGcY;
    public:
    Runner(Movement *movement, Pen *pen, Display *display);
    void start();
    void run();
    void dryRun();
};
#endif
