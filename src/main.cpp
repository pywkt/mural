#include <Arduino.h>
#include <WiFiManager.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <FS.h>
#include <LittleFS.h>
#include <Wire.h>
#include <ESPmDNS.h>
#include "movement.h"
#include "runner.h"
#include "pen.h"
#include "display.h"
#include "phases/phasemanager.h"
#include "AsyncJson.h"
#include "ArduinoJson.h"
#include <esp_task_wdt.h>

AsyncWebServer server(80);

Movement *movement;
Runner *runner;
Pen *pen;
Display *display;

PhaseManager* phaseManager;

void notFound(AsyncWebServerRequest *request)
{
    request->send(404, "text/plain", "Not found");
}

void handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
    phaseManager->getCurrentPhase()->handleUpload(request, filename, index, data, len, final);
}

void handleGetState(AsyncWebServerRequest *request) {
    phaseManager->respondWithState(request);
}

std::vector<const char *> menu = {"wifi", "sep"};
void setup()
{
    delay(10);
    Serial.begin(9600);

    if (!LittleFS.begin(true)) {
        Serial.println("An Error has occurred while mounting LittleFS");
        return;
    }

    display = new Display();
    Serial.println("Initialized display");

    // initialize movement right away or the motors can start creeping due to floating output
    movement = new Movement(display);
    Serial.println("Initialized steppers");

    bool resetAfterConnect = false;
    std::function<void()> serverCallback = [&] () {
        resetAfterConnect = true;
    };
    
    WiFiManager wifiManager;
    
    wifiManager.setConnectTimeout(20);
    wifiManager.setTitle("Connect to WiFi");
    wifiManager.setMenu(menu);
    wifiManager.setWebServerCallback(serverCallback);
    wifiManager.autoConnect("Mural");

    if (resetAfterConnect) {
        Serial.println("Connected to WiFi through captive portal, restarting...");
        ESP.restart();
    }
    
    Serial.println("Connected to wifi");

    MDNS.begin("mural");

    Serial.println("Started mDNS for mural");

    pen = new Pen();
    Serial.println("Initialized servo");

    runner = new Runner(movement, pen, display);
    Serial.println("Initialized runner");

    server.serveStatic("/", LittleFS, "/www/").setDefaultFile("index.html").setCacheControl("no-cache");

    server.on("/command", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->handleCommand(request); });

    server.on("/setTopDistance", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->setTopDistance(request); });

    server.on("/extendToHome", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->extendToHome(request); });

    server.on("/setServo", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->setServo(request); });

    server.on("/setPenDistance", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->setPenDistance(request); });

    server.on("/estepsCalibration", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->estepsCalibration(request); });

    server.on("/doneWithPhase", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->doneWithPhase(request); });

    server.on("/run", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->run(request); });

    server.on("/resume", HTTP_POST, [](AsyncWebServerRequest *request)
              { phaseManager->getCurrentPhase()->resumeTopDistance(request); });

    server.on("/setPenLift", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("amount", true)) {
            int amount = request->getParam("amount", true)->value().toInt();
            pen->setLiftAmount(amount);
        }
        request->send(200);
    });

    server.on("/setDrawSpeed", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("speed", true)) {
            int speed = request->getParam("speed", true)->value().toInt();
            movement->setDrawSpeed(speed);
        }
        request->send(200);
    });

    server.on("/setServoDelay", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("delay", true)) {
            int ms = request->getParam("delay", true)->value().toInt();
            pen->setServoDelay(ms);
        }
        request->send(200);
    });

    server.on("/setServoInversion", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("inverted", true)) {
            pen->setInverted(request->getParam("inverted", true)->value() == "true");
        }
        request->send(200);
    });

    server.on("/setMotorInversion", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("left", true)) {
            movement->setLeftInverted(request->getParam("left", true)->value() == "true");
        }
        if (request->hasParam("right", true)) {
            movement->setRightInverted(request->getParam("right", true)->value() == "true");
        }
        request->send(200);
    });

    server.on("/setPhase", HTTP_POST, [](AsyncWebServerRequest *request) {
        if (request->hasParam("phase", true)) {
            String phase = request->getParam("phase", true)->value();
            if (phaseManager->setPhaseByName(phase)) {
                phaseManager->respondWithState(request);
            } else {
                request->send(400, "text/plain", "Invalid phase");
            }
        } else {
            request->send(400, "text/plain", "Missing phase parameter");
        }
    });

    server.on("/getState", HTTP_GET, [](AsyncWebServerRequest *request)
              { handleGetState(request); });

    server.on("/debug", HTTP_GET, [](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        DynamicJsonBuffer jsonBuffer;
        JsonObject &root = jsonBuffer.createObject();

        // Reset reason
        esp_reset_reason_t reason = esp_reset_reason();
        const char* reasonStr;
        switch (reason) {
            case ESP_RST_POWERON:  reasonStr = "Power on"; break;
            case ESP_RST_SW:      reasonStr = "Software reset"; break;
            case ESP_RST_PANIC:   reasonStr = "Exception/panic"; break;
            case ESP_RST_INT_WDT: reasonStr = "Interrupt watchdog"; break;
            case ESP_RST_TASK_WDT: reasonStr = "Task watchdog"; break;
            case ESP_RST_WDT:     reasonStr = "Other watchdog"; break;
            case ESP_RST_DEEPSLEEP: reasonStr = "Deep sleep wake"; break;
            case ESP_RST_BROWNOUT: reasonStr = "Brownout"; break;
            case ESP_RST_SDIO:    reasonStr = "SDIO"; break;
            default:              reasonStr = "Unknown"; break;
        }
        root["resetReason"] = reasonStr;

        // Memory
        root["freeHeap"] = ESP.getFreeHeap();
        root["minFreeHeap"] = ESP.getMinFreeHeap();
        root["heapSize"] = ESP.getHeapSize();

        // Uptime
        root["uptimeSeconds"] = (long)(millis() / 1000);

        // WiFi
        root["wifiRSSI"] = WiFi.RSSI();
        root["wifiIP"] = WiFi.localIP().toString();

        // Filesystem
        root["fsTotal"] = LittleFS.totalBytes();
        root["fsUsed"] = LittleFS.usedBytes();

        root.printTo(*response);
        request->send(response);
    });

    server.on(
        "/uploadCommands", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            handleGetState(request);
        },
        handleUpload
    );

    // Raw body upload — avoids multipart parsing overhead for large files
    static File rawUploadFile;
    server.on("/uploadCommandsRaw", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            if (rawUploadFile) {
                rawUploadFile.close();
                Serial.println("Raw upload finished");
                // Transition phase (same logic as SvgSelectPhase::handleUpload)
                if (movement->isHomed()) {
                    phaseManager->setPhase(PhaseManager::PenCalibration);
                } else {
                    phaseManager->setPhase(PhaseManager::RetractBelts);
                }
            }
            handleGetState(request);
        },
        nullptr,
        [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
            if (index == 0) {
                if (LittleFS.exists("/commands")) {
                    LittleFS.remove("/commands");
                }
                Serial.printf("Raw upload: %d bytes total, %d bytes free\n", total, LittleFS.totalBytes() - LittleFS.usedBytes());
                if (LittleFS.totalBytes() - LittleFS.usedBytes() < total) {
                    Serial.println("Not enough space on LittleFS");
                    request->send(400, "text/plain", "Not enough space for upload");
                    return;
                }
                rawUploadFile = LittleFS.open("/commands", "w");
                Serial.println("Raw upload started");
            }
            if (rawUploadFile && len) {
                rawUploadFile.write(data, len);
            }
        }
    );

    server.on(
        "/downloadCommands", HTTP_GET,
        [](AsyncWebServerRequest *request) {
            request->send(LittleFS, "/commands", "text/plain");
        }
    );

    server.onNotFound(notFound);

    Serial.println("Finished setting up the server");

    phaseManager = new PhaseManager(movement, pen, runner, &server);

    server.begin();
    Serial.println("Server started");

    display->displayHomeScreen("http://" + WiFi.localIP().toString(), "or", "http://mural.local");

    // Subscribe the main loop task to the task watchdog with a generous timeout
    esp_task_wdt_init(30, true);  // 30 second timeout, panic on trigger
    esp_task_wdt_add(NULL);       // Add current task (loopTask)
    Serial.println("Task watchdog configured (30s timeout)");
}

void loop()
{
    movement->runSteppers();
    runner->run();
    phaseManager->getCurrentPhase()->loopPhase();
    esp_task_wdt_reset();
}
