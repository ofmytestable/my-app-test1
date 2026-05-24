const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("SERVER OK");
});

app.get("/health", (req, res) => {
  res.status(200).send("healthy");
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVER START : ${PORT}`);
});