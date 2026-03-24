#include "runner.h"
#include "tasks/movementtask.h"
#include "tasks/interpolatingmovementtask.h"
#include "tasks/pentask.h"
#include "pen.h"
#include "display.h"
#include "LittleFS.h"
using namespace std;

Runner::Runner(Movement *movement, Pen *pen, Display *display) {
    stopped = true;
    this->movement = movement;
    this->pen = pen;
    this->display = display;
    pendingTask = nullptr;
    isGcode = false;
    gcPenDown = false;
    lastGcX = 0;
    lastGcY = 0;
}

void Runner::initTaskProvider() {
    openedFile = LittleFS.open("/commands");
    if (!openedFile || !openedFile.available()) {
        Serial.println("Failed to open file");
        throw std::invalid_argument("No File");
    }

    pendingTask = nullptr;
    sequenceIx = 0;

    auto line = openedFile.readStringUntil('\n');
    if (line.charAt(0) == 'd') {
        // Mural format
        isGcode = false;
        totalDistance = line.substring(1, line.length() - 1).toDouble();

        auto heightLine = openedFile.readStringUntil('\n');
        if (heightLine.charAt(0) == 'h') {
            auto height = heightLine.substring(1, heightLine.length() - 1).toDouble();
            // we actually dont need it, just validating
        } else {
            Serial.println("Bad file - no height");
            throw std::invalid_argument("bad file");
        }
    } else {
        // G-code format
        isGcode = true;
        gcPenDown = false;
        auto home = movement->getHomeCoordinates();
        lastGcX = home.x;
        lastGcY = home.y;

        // First pass: calculate total distance
        openedFile.seek(0);
        calculateGcodeDistance();
        openedFile.seek(0);
        Serial.println("Detected G-code format");
    }

    Serial.println("Total distance to travel: " + String(totalDistance));

    distanceSoFar = 0;
    progress = -1; // so 0% appears right away
    startPosition = movement->getCoordinates();

    auto homeCoordinates = movement->getHomeCoordinates();
    finishingSequence[0] = new PenTask(true, pen);
    finishingSequence[1] = new InterpolatingMovementTask(movement, homeCoordinates);
}

void Runner::calculateGcodeDistance() {
    totalDistance = 0;
    auto home = movement->getHomeCoordinates();
    double prevX = home.x;
    double prevY = home.y;

    while (openedFile.available()) {
        auto line = openedFile.readStringUntil('\n');
        line.trim();

        // Strip inline comments
        int commentIdx = line.indexOf(';');
        if (commentIdx >= 0) line = line.substring(0, commentIdx);
        line.trim();

        if (line.length() == 0) continue;

        char cmd = toupper(line.charAt(0));
        if (cmd != 'G') continue;

        int spaceIdx = line.indexOf(' ');
        String gStr = (spaceIdx > 0) ? line.substring(1, spaceIdx) : line.substring(1);
        int gCode = gStr.toInt();

        if (gCode != 0 && gCode != 1) continue;

        double x = prevX, y = prevY;

        int xIdx = line.indexOf('X');
        if (xIdx < 0) xIdx = line.indexOf('x');
        if (xIdx >= 0) x = line.substring(xIdx + 1).toDouble();

        int yIdx = line.indexOf('Y');
        if (yIdx < 0) yIdx = line.indexOf('y');
        if (yIdx >= 0) y = line.substring(yIdx + 1).toDouble();

        double dx = x - prevX;
        double dy = y - prevY;
        totalDistance += sqrt(dx * dx + dy * dy);

        prevX = x;
        prevY = y;
    }

    Serial.printf("G-code total distance: %.1f mm\n", totalDistance);
}

void Runner::start() {
    initTaskProvider();
    currentTask = getNextTask();
    currentTask->startRunning();
    stopped = false;
}

Task *Runner::getNextTask()
{
    // Return any pending task from G-code parsing (pen change before move)
    if (pendingTask) {
        Task* task = pendingTask;
        pendingTask = nullptr;
        return task;
    }

    if (openedFile.available())
    {
        if (isGcode) {
            Task* task = getNextGcodeTask();
            if (task) return task;
            // Fall through to finishing sequence if no more valid G-code commands
        } else {
            auto line = openedFile.readStringUntil('\n');
            if (line.charAt(0) == 'p')
            {
                if (line.charAt(1) == '1')
                {
                    return new PenTask(false, pen);
                }
                else
                {
                    return new PenTask(true, pen);
                }
            }
            else
            {
                auto x = line.substring(0, line.indexOf(" ")).toDouble();
                auto y = line.substring(line.indexOf(" ") + 1).toDouble();
                targetPosition = Movement::Point(x, y);
                return new InterpolatingMovementTask(movement, targetPosition);
            }
        }
    }

    // Finishing sequence: pen up, then return home
    if (sequenceIx < (end(finishingSequence) - begin(finishingSequence))) {
        auto currentIx = sequenceIx;
        sequenceIx = sequenceIx + 1;
        return finishingSequence[currentIx];
    } else {
        delay(200);
        ESP.restart();
        // unreachable
        return NULL;
    }
}

Task *Runner::getNextGcodeTask()
{
    while (openedFile.available()) {
        auto line = openedFile.readStringUntil('\n');
        line.trim();

        // Strip inline comments (everything after ;)
        int commentIdx = line.indexOf(';');
        if (commentIdx >= 0) line = line.substring(0, commentIdx);
        line.trim();

        if (line.length() == 0) continue;

        char cmd = toupper(line.charAt(0));

        // Handle M commands (pen control)
        if (cmd == 'M') {
            int spaceIdx = line.indexOf(' ');
            String mStr = (spaceIdx > 0) ? line.substring(1, spaceIdx) : line.substring(1);
            int mCode = mStr.toInt();

            if (mCode == 3 && !gcPenDown) {
                gcPenDown = true;
                return new PenTask(false, pen);
            } else if (mCode == 5 && gcPenDown) {
                gcPenDown = false;
                return new PenTask(true, pen);
            }
            continue;
        }

        // Only process G commands
        if (cmd != 'G') continue;

        int spaceIdx = line.indexOf(' ');
        String gStr = (spaceIdx > 0) ? line.substring(1, spaceIdx) : line.substring(1);
        int gCode = gStr.toInt();

        // Only handle G0 (rapid/travel) and G1 (linear/draw)
        if (gCode != 0 && gCode != 1) continue;

        // Parse X and Y coordinates (keep previous value if axis omitted)
        double x = lastGcX, y = lastGcY;

        int xIdx = line.indexOf('X');
        if (xIdx < 0) xIdx = line.indexOf('x');
        if (xIdx >= 0) x = line.substring(xIdx + 1).toDouble();

        int yIdx = line.indexOf('Y');
        if (yIdx < 0) yIdx = line.indexOf('y');
        if (yIdx >= 0) y = line.substring(yIdx + 1).toDouble();

        lastGcX = x;
        lastGcY = y;

        // G0 = pen up (rapid travel), G1 = pen down (draw)
        bool wantPenDown = (gCode == 1);

        targetPosition = Movement::Point(x, y);
        Task* moveTask = new InterpolatingMovementTask(movement, targetPosition);

        // If pen state needs to change, queue the move and return pen task first
        if (wantPenDown != gcPenDown) {
            gcPenDown = wantPenDown;
            pendingTask = moveTask;
            return new PenTask(!gcPenDown, pen);
        }

        return moveTask;
    }

    return nullptr;
}

void Runner::run()
{
    if (stopped)
    {
        return;
    }

    if (currentTask->isDone())
    {
        if (currentTask->name() == InterpolatingMovementTask::NAME) {
            auto distanceCovered = Movement::distanceBetweenPoints(startPosition, targetPosition);
            distanceSoFar += distanceCovered;
            startPosition = targetPosition;
            auto newProgress = int(floor(distanceSoFar / totalDistance * 100));
            if (newProgress > 100) {
                newProgress = 100;
            }
            if (progress != newProgress) {
                Serial.println("Progress: " + String(newProgress));
                progress = newProgress;
                display->displayText(String(progress) + "%");
            }

        }
        delete currentTask;
        currentTask = getNextTask();
        if (currentTask != NULL)
        {
            currentTask->startRunning();
        }
        else
        {
            stopped = true;
        }
    }
}

void Runner::dryRun() {
    initTaskProvider();
    auto task = getNextTask();
    auto index = 1;
    while (task != NULL) {
        //Serial.println(String(index));
        index = index + 1;
        delete task;
        task = getNextTask();
    }
    Serial.println("All done");
}
