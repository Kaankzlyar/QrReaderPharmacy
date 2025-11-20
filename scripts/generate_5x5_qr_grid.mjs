import fs from "fs";
import QRCode from "qrcode";
import sharp from "sharp";

const products = [
  "PARACETAMOL",
  "IBUPROFEN",
  "ASPIRIN",
  "AMOXICILLIN",
  "VITAMINC",
  "OMEGA3",
  "PANTOPRAZOL",
];

// --- GRID CONFIG (match your 5x5 UI) ---
const GRID_COLS = 5;
const GRID_ROWS = 5;
const TOTAL_QRS = GRID_COLS * GRID_ROWS;

// Each cell in the grid (sheet) in pixels
const CELL_SIZE = 300;          // full cell box
const QR_SIZE = 260;            // actual QR code inside the cell

const OUTPUT_DIR = "generated_qrs";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Build 25 codes compatible with your app logic
const qrList = [];
for (let i = 0; i < TOTAL_QRS; i++) {
  const product = products[i % products.length];
  const lot = (Math.floor(i / products.length) + 1).toString(); // LOT1, LOT2...
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const code = `${product}-${randomPart}-LOT${lot}`;

  const row = Math.floor(i / GRID_COLS);
  const col = i % GRID_COLS;

  qrList.push({ code, row, col });
}

// Generate individual QR PNGs + buffers for grid sheet
async function generateQRCodes() {
  const entries = [];

  for (const item of qrList) {
    const { code, row, col } = item;

    // 1) Save individual PNG (useful for debugging)
    const filePath = `${OUTPUT_DIR}/${code}.png`;
    await QRCode.toFile(filePath, code, {
      width: QR_SIZE, // final PNG width
      margin: 2,
    });

    // 2) Also generate buffer for composing into 5x5 sheet
    const buffer = await QRCode.toBuffer(code, {
      width: QR_SIZE,
      margin: 2,
    });

    entries.push({ code, row, col, buffer });
  }

  return entries;
}

async function buildGridSheet(entries) {
  const sheetWidth = GRID_COLS * CELL_SIZE;
  const sheetHeight = GRID_ROWS * CELL_SIZE;

  // Create white background sheet
  const sheet = sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: "#FFFFFF",
    },
  });

  // Place each QR in its cell, centered
  const composites = entries.map(({ buffer, row, col }) => {
    const left =
      col * CELL_SIZE + Math.round((CELL_SIZE - QR_SIZE) / 2);
    const top =
      row * CELL_SIZE + Math.round((CELL_SIZE - QR_SIZE) / 2);

    return {
      input: buffer,
      left,
      top,
    };
  });

  await sheet.composite(composites).png().toFile(`${OUTPUT_DIR}/grid_5x5.png`);
}

async function main() {
  console.log("🧪 Generating 5x5 QR set...");
  const entries = await generateQRCodes();

  // Save mapping for reference (which code is in which cell)
  const mapping = entries.map(({ code, row, col }) => ({
    code,
    row,
    col,
  }));
  fs.writeFileSync(
    `${OUTPUT_DIR}/qr_map.json`,
    JSON.stringify(mapping, null, 2),
    "utf8"
  );

  console.log("🧩 Building 5x5 grid sheet...");
  await buildGridSheet(entries);

  console.log("✅ Done!");
  console.log("   • Individual PNGs in ./generated_qrs");
  console.log("   • 5x5 sheet: ./generated_qrs/grid_5x5.png");
  console.log("   • Mapping:   ./generated_qrs/qr_map.json");
}

main().catch((err) => {
  console.error("❌ Error:", err);
});
