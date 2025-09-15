const express = require("express");
const client = require("prom-client");
const winston = require("winston");
const LokiTransport = require("winston-loki");

const app = express();

// ----- Winston Logger with Loki -----
const logger = winston.createLogger({
  transports: [
    new LokiTransport({
      host: "http://loki:3100", // Loki service name from docker-compose
      labels: { app: "node-app" },
      json: true,
      format: winston.format.json(),
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// ----- Prometheus Setup -----
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.1, 0.5, 1, 2.5, 5],
});

// Middleware for metrics + logging
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode,
    });
    end({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode,
    });

    logger.info("HTTP Request", {
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
    });
  });
  next();
});

// ----- Routes -----
app.get("/", (req, res) => {
  logger.info("Root route called");
  res.send("Hello");
});

app.get("/slow", (req, res) => {
  const delay = Math.floor(Math.random() * 2500) + 10;
  const shouldError = Math.random() < 0.2;

  setTimeout(() => {
    if (shouldError) {
      logger.error("Internal Server Error on /slow route", { delay });
      res.status(500).send("Internal Server Error");
    } else {
      logger.info("Slow route responded", { delay });
      res.send(`Responded after ${delay}ms`);
    }
  }, delay);
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ----- Start Server -----
const PORT = 3000;
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  logger.info(`Metrics available at http://localhost:${PORT}/metrics`);
});
