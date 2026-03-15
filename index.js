const express = require("express");
const EventEmitter = require("events");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_token_here";

const sse = new EventEmitter();
sse.setMaxListeners(100);
let messages = [];

app.use(express.static(path.join(__dirname, "public")));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  console.log("Webhook received");

  if (req.body && req.body.entry) {
    req.body.entry.forEach((entry) => {
      if (entry.changes) {
        entry.changes.forEach((change) => {
          const value = change.value;
          if (value && value.messages) {
            value.messages.forEach((msg) => {
              const text =
                msg.text && msg.text.body
                  ? msg.text.body
                  : msg.body || JSON.stringify(msg);
              const from =
                msg.from ||
                (value.metadata && value.metadata.phone_number_id) ||
                "unknown";
              const item = { from, text, timestamp: Date.now() };
              messages.unshift(item);
              if (messages.length > 100) messages.pop();
              sse.emit("message", JSON.stringify(item));
              console.log("Message:", item);
            });
          }
        });
      }
    });
  }

  res.sendStatus(200);
});

app.get("/messages", (req, res) => {
  res.json(messages);
});

app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${data}\n\n`);
  };

  // send existing messages once
  send(JSON.stringify({ type: "init", messages }));

  const onMessage = (data) => send(data);
  sse.on("message", onMessage);

  req.on("close", () => {
    sse.removeListener("message", onMessage);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
