import fs from "fs";
import QRCode from "qrcode";

const products = [
  "PARACETAMOL",
  "IBUPROFEN",
  "ASPIRIN",
  "AMOXICILLIN",
  "VITAMINC",
  "OMEGA3",
  "PANTOPRAZOL"
];

let qrList = [];

for (const p of products) {
  for (let i = 1; i <= 3; i++) {
    const code = `${p}-${Math.random().toString(36).substring(2, 8).toUpperCase()}-LOT${i}`;
    qrList.push(code);
  }
}

// generate folder
fs.mkdirSync("generated_qrs", { recursive: true });

for (const code of qrList) {
  QRCode.toFile(`generated_qrs/${code}.png`, code, { width: 300 });
}

console.log("✅  QR codes generated in ./generated_qrs folder!");
