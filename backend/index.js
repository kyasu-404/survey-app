const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

/* INIT TABLES */
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS forms (
      id SERIAL PRIMARY KEY,
      title TEXT,
      form_type TEXT,
      form_reason TEXT,
      schema JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      form_id INT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
})();

/* SAVE FORM */
app.post("/forms", async (req, res) => {
  const { title, formType, formReason, schema } = req.body;

  const result = await pool.query(
    "INSERT INTO forms(title, form_type, form_reason, schema) VALUES($1,$2,$3,$4) RETURNING *",
    [title, formType, formReason, schema]
  );

  res.json(result.rows[0]);
});

/* GET FORM */
app.get("/forms/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM forms WHERE id=$1", [
    req.params.id
  ]);

  res.json(result.rows[0]);
});

/* SAVE RESPONSE */
app.post("/responses", async (req, res) => {
  const { formId, data } = req.body;

  await pool.query(
    "INSERT INTO responses(form_id, data) VALUES($1,$2)",
    [formId, data]
  );

  res.json({ ok: true });
});

app.listen(3000, () => console.log("Backend running"));
