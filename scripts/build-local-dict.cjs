'use strict';

// Builds dict/zh-gloss.json from ECDICT (MIT, https://github.com/skywind3000/ECDICT).
// Usage: node scripts/build-local-dict.cjs [path-to-ecdict.csv] [max-words]
// Output: { "__meta__": {...}, "word": ["phonetic", "translation"], ... }

const fs = require('node:fs');
const path = require('node:path');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'ecdict.csv');
const maxWords = Number(process.argv[3]) || 30000;
const outputPath = path.join(__dirname, '..', 'dict', 'zh-gloss.json');

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      fields.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
}

function cleanTranslation(raw) {
  const lines = String(raw || '')
    .split(/\\n|\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[网络]') && !line.startsWith('[人名]'));
  if (!lines.length) return '';
  const merged = lines.slice(0, 4).join('\\n');
  return merged.length > 220 ? `${merged.slice(0, 220)}…` : merged;
}

function main() {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const wordIndex = header.indexOf('word');
  const phoneticIndex = header.indexOf('phonetic');
  const translationIndex = header.indexOf('translation');
  const bncIndex = header.indexOf('bnc');
  const frqIndex = header.indexOf('frq');
  const rows = [];
  for (let index = 1; index < lines.length; index++) {
    if (!lines[index]) continue;
    const fields = parseCsvLine(lines[index]);
    const word = fields[wordIndex];
    if (!word || !/^[A-Za-z][A-Za-z' -]*$/.test(word)) continue;
    const translation = cleanTranslation(fields[translationIndex]);
    if (!translation) continue;
    const frq = Number(frqIndex >= 0 ? fields[frqIndex] : 0) || 0;
    const bnc = Number(bncIndex >= 0 ? fields[bncIndex] : 0) || 0;
    rows.push({ word: word.toLowerCase(), phonetic: fields[phoneticIndex] || '', translation, rank: frq > 0 ? frq : (bnc > 0 ? 1000000 + bnc : 2000000 + index) });
  }
  rows.sort((left, right) => left.rank - right.rank);
  const result = {
    __meta__: {
      source: 'ECDICT (MIT License, https://github.com/skywind3000/ECDICT)',
      generatedAt: new Date().toISOString().slice(0, 10),
      words: 0
    }
  };
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.word)) continue;
    seen.add(row.word);
    result[row.word] = [row.phonetic, row.translation];
    if (seen.size >= maxWords) break;
  }
  result.__meta__.words = seen.size;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result));
  const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`OK: ${seen.size} words -> ${outputPath} (${sizeMb} MB)`);
}

main();
