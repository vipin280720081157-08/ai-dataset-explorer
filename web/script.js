/*
 * AI Dataset Explorer - browser-side analysis and interface.
 *
 * IMPORTANT: this file runs JavaScript in the visitor's browser.
 * It does NOT execute R. It re-implements the same analysis rules that
 * are written in R/functions.R, so both give the same observations
 * for the same CSV file (see the README and the "About" section).
 *
 * Part 1 (top):    analysis rules  - no HTML, no DOM
 * Part 2 (bottom): user interface  - reads a CSV, calls Part 1, draws the report
 */
"use strict";

/* ====================================================================
   PART 1 - ANALYSIS RULES (kept identical to R/functions.R)
   ==================================================================== */

// Text values treated as "missing" (after trimming spaces).
var MISSING_TOKENS = ["", "NA", "N/A", "NaN", "NULL", "null"];
// A categorical column with MORE unique values than this is flagged.
var HIGH_CARDINALITY_THRESHOLD = 10;
// How many of the most frequent categories are listed.
var TOP_N_CATEGORIES = 5;
// A text column is called "mixed type" if at least this share of its
// non-missing values look like numbers (but not all of them).
var MIXED_NUMERIC_SHARE = 0.8;
// Numbers are rounded to this many decimals.
var DECIMALS = 2;

var NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB limit for uploads

// ---------- friendly error type ----------
function DatasetError(message) {
  this.name = "DatasetError";
  this.message = message;
}
DatasetError.prototype = Object.create(Error.prototype);

// ---------- reading the CSV ----------

// Splits CSV text into rows of text values. Handles quoted fields,
// doubled quotes (""), commas/new lines inside quotes and CRLF line ends.
// Completely empty lines are skipped.
function parseCsvText(text) {
  var rows = [];
  var row = [];
  var field = "";
  var inQuotes = false;
  var fieldStarted = false;
  var rowHasContent = false;
  var i = 0;

  function finishRow() {
    if (rowHasContent) {
      row.push(field);
      rows.push(row);
    }
    row = [];
    field = "";
    fieldStarted = false;
    rowHasContent = false;
  }

  while (i < text.length) {
    var ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      rowHasContent = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
      rowHasContent = true;
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text.charAt(i + 1) === "\n") {
        i++;
      }
      i++;
      finishRow();
      continue;
    }
    field += ch;
    fieldStarted = true;
    rowHasContent = true;
    i++;
  }
  if (inQuotes) {
    throw new DatasetError(
      "Invalid CSV: a quotation mark was opened but never closed."
    );
  }
  finishRow();
  return rows;
}

// Trims a value and converts missing tokens to null.
function normalizeValue(value) {
  var trimmed = value.trim();
  return MISSING_TOKENS.indexOf(trimmed) !== -1 ? null : trimmed;
}

// Blank names become Unnamed_column_N, repeated names get ".1", ".2" ...
function prepareColumnNames(headerRow) {
  var seen = Object.create(null);
  return headerRow.map(function (rawName, index) {
    var name = rawName.trim();
    if (name === "") {
      name = "Unnamed_column_" + (index + 1);
    }
    seen[name] = (seen[name] || 0) + 1;
    return seen[name] === 1 ? name : name + "." + (seen[name] - 1);
  });
}

// Reads CSV text and checks that it is a usable dataset.
// Returns { name, columnNames, rows } or throws a DatasetError.
function loadDatasetFromText(name, text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new DatasetError(
      "The file is empty. Please choose a CSV file with a header row and data rows."
    );
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1); // remove byte-order mark
  }
  if (text.indexOf("\u0000") !== -1) {
    throw new DatasetError("This file does not look like a plain-text CSV file.");
  }

  var rawRows = parseCsvText(text);
  if (rawRows.length === 0) {
    throw new DatasetError("The file does not contain any rows.");
  }

  var expectedColumns = rawRows[0].length;
  for (var r = 1; r < rawRows.length; r++) {
    if (rawRows[r].length !== expectedColumns) {
      throw new DatasetError(
        "Invalid CSV: data row " + r + " has " + rawRows[r].length +
        " value(s) but the header has " + expectedColumns + " column(s)."
      );
    }
  }
  if (rawRows.length === 1) {
    throw new DatasetError(
      "The dataset has column names but no data rows, so there is nothing to analyse."
    );
  }

  return {
    name: name,
    columnNames: prepareColumnNames(rawRows[0]),
    rows: rawRows.slice(1).map(function (row) {
      return row.map(normalizeValue);
    })
  };
}

// ---------- column type detection ----------

function isNumberText(value) {
  return NUMBER_PATTERN.test(value);
}

// True for a real calendar date written as YYYY-MM-DD.
function isIsoDateText(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  var year = Number(value.slice(0, 4));
  var month = Number(value.slice(5, 7));
  var day = Number(value.slice(8, 10));
  var date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateToDays(value) {
  var date = new Date(0);
  date.setUTCFullYear(
    Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))
  );
  return Math.round(date.getTime() / 86400000);
}

// Returns "empty", "numeric", "date" or "categorical".
function classifyColumn(values) {
  var present = values.filter(function (v) { return v !== null; });
  if (present.length === 0) { return "empty"; }
  if (present.every(isNumberText)) { return "numeric"; }
  if (present.every(isIsoDateText)) { return "date"; }
  return "categorical";
}

// ---------- small helpers ----------

function roundTo(value, decimals) {
  return Number(value.toFixed(decimals));
}

function percentOf(part, whole) {
  return whole === 0 ? 0 : roundTo((100 * part) / whole, DECIMALS);
}

function medianOf(numbers) {
  var sorted = numbers.slice().sort(function (a, b) { return a - b; });
  var middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function uniqueCountOf(values) {
  var seen = Object.create(null);
  var count = 0;
  values.forEach(function (v) {
    if (!Object.prototype.hasOwnProperty.call(seen, v)) {
      seen[v] = true;
      count++;
    }
  });
  return count;
}

// ---------- per-column analysis ----------

function summarizeNumeric(present) {
  var numbers = present.map(Number);
  var sum = numbers.reduce(function (a, b) { return a + b; }, 0);
  return {
    count: numbers.length,
    min: roundTo(Math.min.apply(null, numbers), DECIMALS),
    max: roundTo(Math.max.apply(null, numbers), DECIMALS),
    mean: roundTo(sum / numbers.length, DECIMALS),
    median: roundTo(medianOf(numbers), DECIMALS),
    sum: roundTo(sum, DECIMALS)
  };
}

function summarizeDate(present) {
  var days = present.map(dateToDays);
  var minDays = Math.min.apply(null, days);
  var maxDays = Math.max.apply(null, days);
  var sorted = present.slice().sort();
  return {
    earliest: sorted[0],
    latest: sorted[sorted.length - 1],
    spanDays: maxDays - minDays
  };
}

// Most frequent first; ties are sorted by the text itself (plain A-Z order).
function frequencyTable(present, topN) {
  var counts = Object.create(null);
  present.forEach(function (v) {
    counts[v] = (counts[v] || 0) + 1;
  });
  var table = Object.keys(counts).map(function (value) {
    return { value: value, count: counts[value] };
  });
  table.sort(function (a, b) {
    if (b.count !== a.count) { return b.count - a.count; }
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
  return table.slice(0, topN).map(function (item) {
    return {
      value: item.value,
      count: item.count,
      percent: percentOf(item.count, present.length)
    };
  });
}

function profileColumn(name, index, values, rowCount) {
  var present = values.filter(function (v) { return v !== null; });
  var type = classifyColumn(values);
  var uniqueCount = uniqueCountOf(present);
  var numericLooking = present.filter(isNumberText).length;
  var numericShare = present.length === 0 ? 0 : numericLooking / present.length;

  var profile = {
    index: index,
    name: name,
    type: type,
    valueCount: present.length,
    missingCount: rowCount - present.length,
    missingPercent: percentOf(rowCount - present.length, rowCount),
    uniqueCount: uniqueCount,
    allUnique: present.length > 1 && uniqueCount === present.length,
    mixedType: type === "categorical" && numericShare >= MIXED_NUMERIC_SHARE,
    // mixed-type columns are reported separately, not as high cardinality
    highCardinality: false,
    numeric: null,
    date: null,
    topValues: null
  };

  profile.highCardinality =
    type === "categorical" && !profile.mixedType && uniqueCount > HIGH_CARDINALITY_THRESHOLD;

  if (type === "numeric") { profile.numeric = summarizeNumeric(present); }
  if (type === "date") { profile.date = summarizeDate(present); }
  if (type === "categorical") { profile.topValues = frequencyTable(present, TOP_N_CATEGORIES); }
  return profile;
}

// ---------- duplicate rows ----------

// A row is a duplicate if an identical row appeared earlier.
function findDuplicateRows(rows) {
  var seen = Object.create(null);
  var rowNumbers = [];
  rows.forEach(function (row, index) {
    var key = JSON.stringify(row);
    if (Object.prototype.hasOwnProperty.call(seen, key)) {
      rowNumbers.push(index + 1); // data row number (header not counted)
    } else {
      seen[key] = true;
    }
  });
  return { count: rowNumbers.length, rowNumbers: rowNumbers };
}

// ---------- quality checks and readiness observations ----------

function namesOf(columns) {
  return columns.map(function (c) { return c.name; }).join(", ");
}

function buildQualityChecks(report) {
  var o = report.overview;
  var highCard = report.columns.filter(function (c) { return c.highCardinality; });
  var mixed = report.columns.filter(function (c) { return c.mixedType; });
  var checks = [];

  function add(label, status, detail) {
    checks.push({ label: label, status: status, detail: detail });
  }

  add("Dataset Loaded", "OK", "Dataset loaded successfully.");
  add("Rows Present", report.rowCount > 0 ? "OK" : "Attention", "Rows found: " + report.rowCount);
  add("Columns Present", report.columnCount > 0 ? "OK" : "Attention", "Columns found: " + report.columnCount);
  add("Missing Values",
    o.totalMissingCells > 0 ? "Attention" : "OK",
    o.totalMissingCells > 0
      ? "Columns with missing values: " + o.columnsWithMissing.length + " (" + o.totalMissingCells + " missing cells)"
      : "None detected");
  add("Duplicate Rows",
    report.duplicates.count > 0 ? "Attention" : "OK",
    report.duplicates.count > 0 ? "Duplicate rows detected: " + report.duplicates.count : "None detected");
  add("Numerical Columns", o.numericCount > 0 ? "OK" : "Info",
    o.numericCount > 0 ? "Detected: " + o.numericCount : "None detected");
  add("Categorical Columns", o.categoricalCount > 0 ? "OK" : "Info",
    o.categoricalCount > 0 ? "Detected: " + o.categoricalCount : "None detected");
  add("High Cardinality", highCard.length > 0 ? "Attention" : "OK",
    highCard.length > 0 ? "Detected: " + namesOf(highCard) : "None detected");
  add("Mixed-Type Columns", mixed.length > 0 ? "Attention" : "OK",
    mixed.length > 0 ? "Detected: " + namesOf(mixed) : "None detected");
  return checks;
}

function buildReadinessObservations(report) {
  var o = report.overview;
  var highCard = report.columns.filter(function (c) { return c.highCardinality; });
  var mixed = report.columns.filter(function (c) { return c.mixedType; });
  var status = [];
  var structure = [];
  var quality = [];
  var notes = [];

  status.push("Loaded successfully: " + report.rowCount + " rows and " + report.columnCount + " columns.");

  structure.push(o.numericCount > 0
    ? "Numerical columns detected (" + o.numericCount + ")."
    : "No numerical columns detected.");
  structure.push(o.categoricalCount > 0
    ? "Categorical columns detected (" + o.categoricalCount + ")."
    : "No categorical columns detected.");
  if (o.dateCount > 0) {
    structure.push("Date columns detected (" + o.dateCount + ").");
  }

  quality.push(o.totalMissingCells > 0
    ? "Missing values detected in " + o.columnsWithMissing.length + " column(s) (" + o.totalMissingCells + " cells)."
    : "No missing values detected.");
  quality.push(report.duplicates.count > 0
    ? "Duplicate rows detected (" + report.duplicates.count + ")."
    : "No duplicate rows detected.");
  if (highCard.length > 0) {
    quality.push("Possible high-cardinality categorical column(s): " + namesOf(highCard) + ".");
  }
  if (mixed.length > 0) {
    quality.push("Possible mixed-type column(s): " + namesOf(mixed) + ".");
  }

  if (o.totalMissingCells > 0) {
    notes.push("Review missing values and choose an appropriate handling strategy before model training.");
  }
  if (report.duplicates.count > 0) {
    notes.push("Review duplicate rows before model training.");
  }
  if (o.categoricalCount > 0) {
    notes.push("Review categorical encoding requirements before model training.");
  }
  if (highCard.length > 0) {
    notes.push("Columns with many unique categories may need extra consideration during preprocessing or encoding.");
  }
  if (mixed.length > 0) {
    notes.push("Check whether mixed-type columns contain data-entry issues or intended text values.");
  }
  if (o.numericCount > 0) {
    notes.push("Review numerical ranges (minimum and maximum) for unexpected values.");
  }
  notes.push("This is an initial inspection only. It does not confirm that the dataset is ready for AI/ML use.");

  return { status: status, structure: structure, dataQuality: quality, preparationNotes: notes };
}

// ---------- the complete analysis ----------

function analyzeDataset(dataset) {
  var rowCount = dataset.rows.length;
  var columnCount = dataset.columnNames.length;

  var columns = dataset.columnNames.map(function (name, index) {
    var values = dataset.rows.map(function (row) { return row[index]; });
    return profileColumn(name, index, values, rowCount);
  });

  function countType(type) {
    return columns.filter(function (c) { return c.type === type; }).length;
  }
  var withMissing = columns.filter(function (c) { return c.missingCount > 0; });

  var report = {
    name: dataset.name,
    rowCount: rowCount,
    columnCount: columnCount,
    totalCells: rowCount * columnCount,
    columns: columns,
    overview: {
      numericCount: countType("numeric"),
      categoricalCount: countType("categorical"),
      dateCount: countType("date"),
      emptyCount: countType("empty"),
      columnsWithMissing: withMissing.map(function (c) { return c.name; }),
      totalMissingCells: columns.reduce(function (sum, c) { return sum + c.missingCount; }, 0)
    },
    duplicates: findDuplicateRows(dataset.rows)
  };
  report.checks = buildQualityChecks(report);
  report.readiness = buildReadinessObservations(report);
  return report;
}

/* ====================================================================
   PART 2 - USER INTERFACE
   ==================================================================== */

var SAMPLE_DATASETS = [
  {
    file: "customers_demo.csv",
    title: "Customer information",
    description: "Customers with age, city, membership level, yearly spend and sign-up date.",
    tags: ["Numerical", "Categorical", "Missing values", "Date column"]
  },
  {
    file: "movies_demo.csv",
    title: "Movie information",
    description: "Movies with genre, release year, rating, duration and language.",
    tags: ["Duplicate rows", "No missing values"]
  },
  {
    file: "weather_demo.csv",
    title: "Weather observations",
    description: "Daily readings for three cities: temperature, humidity, rainfall and condition.",
    tags: ["Date column", "No missing values", "No duplicates"]
  },
  {
    file: "products_demo.csv",
    title: "Product information",
    description: "Products with category, brand, price, stock, rating and weight.",
    tags: ["High cardinality", "Mixed-type columns", "Missing values"]
  }
];

var SAMPLE_DATA_FALLBACK = {
  "customers_demo.csv": "customer_id,age,gender,city,membership,annual_spend,signup_date\n1001,59,Male,Coimbatore,Basic,1769,2024-01-30\n1002,27,Female,Hyderabad,Silver,7207,2023-11-24\n1003,21,Female,Hyderabad,Gold,1059,2022-08-12\n1004,,Male,Coimbatore,Silver,5683,2024-01-04\n1005,56,Female,Coimbatore,Gold,3220,2024-06-09\n1006,46,Female,,Basic,3760,2022-06-09\n1007,24,Male,Hyderabad,Silver,4105,2023-01-03\n1008,21,Female,Bengaluru,Basic,7149,\n1009,54,Male,Hyderabad,Basic,3351,2023-10-06\n1010,,Female,Madurai,Basic,1405,2023-11-09\n1011,33,Male,Bengaluru,Gold,8338,2023-01-25\n1012,42,Female,Kochi,Silver,,2022-12-30\n1013,63,Female,Hyderabad,Gold,8949,2023-10-26\n1014,29,Female,Bengaluru,Silver,5447,2022-09-08\n1015,,Female,Kochi,Silver,9409,2023-10-18\n1016,22,Male,Bengaluru,Silver,2793,2022-02-02\n1017,23,Male,Coimbatore,Gold,2636,2023-08-04\n1018,50,Male,Coimbatore,Silver,4242,2023-10-21\n1019,27,Male,,Gold,2946,2023-07-29\n1020,46,Male,Coimbatore,Basic,8611,2023-02-13\n1021,51,Female,Chennai,Basic,5094,2024-02-13\n1022,59,Male,Hyderabad,Basic,2192,2023-11-28\n1023,,Male,Hyderabad,Basic,4120,2023-04-25\n1024,62,Male,Kochi,Silver,7070,2023-11-30\n1025,26,Male,Chennai,Gold,3353,2022-06-11\n1026,35,Female,Hyderabad,Basic,,2024-02-20\n1027,59,Female,Coimbatore,Silver,3396,2023-10-17\n1028,29,Female,,Silver,5493,2024-03-08\n1029,50,Male,Coimbatore,Basic,969,2023-01-07\n1030,34,Female,Kochi,Silver,8439,\n1031,23,Female,Coimbatore,Gold,9308,2023-06-30\n1032,,Male,Hyderabad,Gold,9038,2022-06-19\n1033,46,Female,Kochi,Silver,9190,2023-07-07\n1034,44,Male,Bengaluru,Gold,,2023-10-28\n1035,47,Female,Madurai,Basic,1853,2022-08-19\n1036,56,Female,Chennai,Basic,5619,2023-08-26\n1037,64,Female,Chennai,Silver,,2022-08-23\n1038,23,Male,Coimbatore,Gold,5273,2022-10-13\n1039,27,Male,Coimbatore,Silver,7093,2023-08-08\n1040,45,Male,Madurai,Silver,2457,2022-04-10",
  "movies_demo.csv": "movie_id,title,genre,release_year,rating,duration_minutes,language\n2001,Last Letter,Thriller,2009,8.3,86,Hindi\n2002,Crimson Mirror,Drama,1996,6.0,123,English\n2003,Wild Garden,Comedy,2001,5.0,137,English\n2004,Hidden Season,Thriller,2000,5.4,111,English\n2005,Midnight Bridge,Thriller,2020,8.3,150,English\n2006,Quiet Signal,Drama,2015,9.0,81,English\n2007,Golden Horizon,Comedy,2000,6.0,141,English\n2008,Broken Valley,Thriller,2023,4.3,128,English\n2009,Distant Journey,Thriller,2003,8.6,138,Tamil\n2010,Silent Harbor,Thriller,2017,8.8,151,Hindi\n2011,Last Letter,Thriller,1999,4.9,107,English\n2012,Crimson Mirror,Documentary,2018,6.7,120,English\n2013,Wild Garden,Drama,2013,6.4,147,English\n2014,Hidden Season,Drama,2011,4.4,103,English\n2015,Midnight Bridge,Documentary,1997,7.4,110,Tamil\n2016,Quiet Signal,Drama,2023,6.8,154,Hindi\n2017,Golden Horizon,Drama,2014,4.4,164,Hindi\n2018,Broken Valley,Documentary,2011,5.6,113,English\n2019,Distant Journey,Action,2002,5.3,96,Hindi\n2020,Silent Harbor,Action,2009,5.6,89,English\n2021,Last Letter,Thriller,2014,9.0,92,English\n2022,Crimson Mirror,Documentary,2001,6.5,96,Tamil\n2023,Wild Garden,Drama,2023,5.2,116,English\n2024,Hidden Season,Thriller,2021,6.7,118,Hindi\n2025,Midnight Bridge,Documentary,1995,7.3,150,Tamil\n2026,Quiet Signal,Drama,2023,4.7,94,English\n2027,Golden Horizon,Documentary,1999,5.4,157,English\n2028,Broken Valley,Action,2001,7.4,113,Hindi\n2005,Midnight Bridge,Thriller,2020,8.3,150,English\n2018,Broken Valley,Documentary,2011,5.6,113,English",
  "weather_demo.csv": "date,city,temperature_c,humidity_pct,rainfall_mm,condition\n2024-06-01,Chennai,27.0,48,0.0,Cloudy\n2024-06-01,Coimbatore,31.6,62,0.0,Sunny\n2024-06-01,Bengaluru,24.0,53,0.0,Sunny\n2024-06-02,Chennai,32.8,63,30.2,Rainy\n2024-06-02,Coimbatore,29.5,88,2.4,Rainy\n2024-06-02,Bengaluru,35.3,89,0.0,Sunny\n2024-06-03,Chennai,30.5,68,0.0,Sunny\n2024-06-03,Coimbatore,27.6,80,6.8,Rainy\n2024-06-03,Bengaluru,28.4,47,0.0,Cloudy\n2024-06-04,Chennai,26.5,60,0.0,Cloudy\n2024-06-04,Coimbatore,22.2,88,35.6,Rainy\n2024-06-04,Bengaluru,35.7,54,0.0,Cloudy\n2024-06-05,Chennai,34.4,56,0.0,Sunny\n2024-06-05,Coimbatore,24.3,66,0.0,Cloudy\n2024-06-05,Bengaluru,33.6,60,0.0,Cloudy\n2024-06-06,Chennai,25.9,89,0.0,Cloudy\n2024-06-06,Coimbatore,28.6,47,0.0,Sunny\n2024-06-06,Bengaluru,26.7,74,0.0,Cloudy\n2024-06-07,Chennai,27.7,59,0.0,Cloudy\n2024-06-07,Coimbatore,24.3,57,0.0,Sunny\n2024-06-07,Bengaluru,27.9,49,0.0,Cloudy\n2024-06-08,Chennai,28.2,77,0.0,Cloudy\n2024-06-08,Coimbatore,32.2,79,0.0,Cloudy\n2024-06-08,Bengaluru,35.3,52,0.0,Cloudy\n2024-06-09,Chennai,26.1,61,0.0,Cloudy\n2024-06-09,Coimbatore,25.3,72,0.0,Sunny\n2024-06-09,Bengaluru,32.7,65,0.0,Cloudy\n2024-06-10,Chennai,31.3,77,0.0,Cloudy\n2024-06-10,Coimbatore,28.6,81,0.0,Sunny\n2024-06-10,Bengaluru,27.1,90,0.0,Sunny",
  "products_demo.csv": "product_id,product_name,category,brand,price,stock_quantity,rating,weight_kg\n5001,Compact Lamp,Sports,Aurex,2553.23,206,4.0,4.34\n5002,Compact Speaker,Home,Cobalt,2138.47,242,4.3,2.05\n5003,Compact Notebook,Stationery,Aurex,3488.45,76,,4.03\n5004,Compact Bottle,Stationery,Dynamo,3382.94,141,3.1,2.58\n5005,Compact Backpack,Sports,Brightly,3000.61,77,3.7,5.02\n5006,Compact Mouse,Stationery,Cobalt,1103.65,201,4.1,3.96\n5007,Classic Lamp,Sports,Dynamo,2189.31,54,3.9,4.78\n5008,Classic Speaker,Home,Aurex,1448.12,169,4.2,2.08\n5009,Classic Notebook,Home,Cobalt,1171.32,50,,0.37\n5010,Classic Bottle,Sports,Aurex,2251.35,226,4.2,1.25\n5011,Classic Backpack,Sports,Dynamo,1990.38,37,4.2,0.13\n5012,Classic Mouse,Electronics,Dynamo,1144.18,205,4.9,3.16\n5013,Smart Lamp,Electronics,Brightly,4413.76,31,3.8,unknown\n5014,Smart Speaker,Stationery,Dynamo,2987.21,184,4.8,2.62\n5015,Smart Notebook,Sports,Brightly,3600.31,121,3.8,4.54\n5016,Smart Bottle,Stationery,Dynamo,3053.18,70,,4.31\n5017,Smart Backpack,Home,Cobalt,1691.77,228,4.0,0.92\n5018,Smart Mouse,Home,Dynamo,3367.69,180,3.3,2.55\n5019,Eco Lamp,Stationery,Dynamo,2065.82,52,4.6,2.4\n5020,Eco Speaker,Electronics,Dynamo,2352.27,out of stock,3.6,4.55\n5021,Eco Notebook,Sports,Brightly,2404.91,69,3.8,0.27\n5022,Eco Bottle,Stationery,Dynamo,3509.17,215,,0.85\n5023,Eco Backpack,Electronics,Dynamo,2890.06,169,2.9,3.89\n5024,Eco Mouse,Home,Dynamo,970.49,66,3.6,1.35\n5025,Pro Lamp,Stationery,Cobalt,3682.56,97,3.4,5.71\n5026,Pro Speaker,Sports,Cobalt,4027.38,120,2.8,3.28\n5027,Pro Notebook,Stationery,Brightly,3162.67,199,4.9,unknown\n5028,Pro Bottle,Electronics,Brightly,1053.01,5,4.2,1.51\n5029,Pro Backpack,Sports,Aurex,2759.38,55,3.8,1.61\n5030,Pro Mouse,Stationery,Brightly,2955.58,246,4.4,0.78\n5031,Mini Lamp,Home,Cobalt,625.9,6,,3.5\n5032,Mini Speaker,Sports,Dynamo,4526.08,50,3.0,4.17\n5033,Mini Notebook,Home,Aurex,3382.86,77,4.7,3.64\n5034,Mini Bottle,Electronics,Aurex,1744.91,109,4.3,0.51\n5035,Mini Backpack,Stationery,Aurex,4096.01,210,3.9,2.66\n5036,Mini Mouse,Stationery,Dynamo,3430.2,111,3.2,3.18"
};

var TYPE_LABELS = {
  numeric: "Numerical",
  categorical: "Categorical",
  date: "Date",
  empty: "Empty"
};

var TYPE_EXPLANATIONS = {
  numeric: "Every non-missing value in this column is a number.",
  categorical: "This column contains text labels (categories) rather than only numbers or dates.",
  date: "Every non-missing value is a calendar date written as YYYY-MM-DD.",
  empty: "This column has no values at all (every cell is missing)."
};

var appState = { report: null, selectedColumn: 0 };

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(value) {
  if (value === null || value === undefined || isNaN(value)) { return "-"; }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: DECIMALS });
}

function fmtPct(value) {
  return fmtNum(value) + "%";
}

function typeBadge(type) {
  return '<span class="badge badge-' + type + '">' + TYPE_LABELS[type] + "</span>";
}

function statusBadge(status) {
  var symbol = status === "OK" ? "&#10003; OK" : status;
  return '<span class="badge status-' + status.toLowerCase() + '">' + symbol + "</span>";
}

function summaryCard(label, value, tone) {
  return '<div class="card stat-card ' + (tone || "") + '"><span class="stat-value">' +
    value + '</span><span class="stat-label">' + label + "</span></div>";
}

function emptyState(text) {
  return '<p class="empty-state">' + esc(text) + "</p>";
}

function listHtml(items) {
  return "<ul>" + items.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") + "</ul>";
}

/* ---------- section renderers ---------- */

function renderOverview(report, sourceLabel) {
  var o = report.overview;
  var tone = function (n) { return n > 0 ? "tone-attention" : "tone-ok"; };

  var segments = [
    { type: "numeric", count: o.numericCount },
    { type: "categorical", count: o.categoricalCount },
    { type: "date", count: o.dateCount },
    { type: "empty", count: o.emptyCount }
  ].filter(function (s) { return s.count > 0; });

  var bar = segments.map(function (s) {
    return '<div class="seg seg-' + s.type + '" style="width:' +
      (100 * s.count / report.columnCount) + '%" title="' + TYPE_LABELS[s.type] + ": " + s.count + '"></div>';
  }).join("");
  var legend = segments.map(function (s) {
    return '<span class="legend-item"><i class="dot seg-' + s.type + '"></i>' +
      TYPE_LABELS[s.type] + ": " + s.count + "</span>";
  }).join("");

  return '<p class="dataset-line"><strong>Dataset:</strong> ' + esc(report.name) +
    ' <span class="badge badge-info">' + esc(sourceLabel) + "</span></p>" +
    '<div class="card-grid">' +
    summaryCard("Rows", fmtNum(report.rowCount)) +
    summaryCard("Columns", fmtNum(report.columnCount)) +
    summaryCard("Total cells", fmtNum(report.totalCells)) +
    summaryCard("Numerical columns", o.numericCount) +
    summaryCard("Categorical columns", o.categoricalCount) +
    summaryCard("Date columns", o.dateCount) +
    summaryCard("Columns with missing values", o.columnsWithMissing.length, tone(o.columnsWithMissing.length)) +
    summaryCard("Missing cells", fmtNum(o.totalMissingCells), tone(o.totalMissingCells)) +
    summaryCard("Duplicate rows", fmtNum(report.duplicates.count), tone(report.duplicates.count)) +
    "</div>" +
    '<div class="card"><h3>Column types</h3><div class="stack-bar">' + bar + "</div>" +
    '<div class="legend">' + legend + "</div></div>";
}

function renderColumnTable(report) {
  var rows = report.columns.map(function (c) {
    return '<tr class="selectable' + (c.index === appState.selectedColumn ? " selected" : "") +
      '" data-index="' + c.index + '" tabindex="0">' +
      "<td>" + esc(c.name) + "</td><td>" + typeBadge(c.type) + "</td>" +
      '<td class="num">' + fmtNum(c.valueCount) + '</td><td class="num">' + fmtNum(c.missingCount) +
      '</td><td class="num">' + fmtPct(c.missingPercent) + '</td><td class="num">' + fmtNum(c.uniqueCount) + "</td></tr>";
  }).join("");
  return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    "<th>Column</th><th>Type</th><th>Values</th><th>Missing</th><th>Missing %</th><th>Unique</th>" +
    "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}

function renderColumnDetail(column, rowCount) {
  var notes = [];
  if (column.allUnique) { notes.push("Every value in this column is different (it may be an identifier)."); }
  if (column.mixedType) { notes.push("Most values look like numbers, but some are text. This is a possible mixed-type column."); }
  if (column.highCardinality) { notes.push("Possible high-cardinality column: it has many different categories."); }

  var stats =
    summaryCard("Values (not missing)", fmtNum(column.valueCount)) +
    summaryCard("Missing values", fmtNum(column.missingCount), column.missingCount > 0 ? "tone-attention" : "") +
    summaryCard("Missing %", fmtPct(column.missingPercent)) +
    summaryCard("Unique values", fmtNum(column.uniqueCount));

  if (column.numeric) {
    stats += summaryCard("Minimum", fmtNum(column.numeric.min)) +
      summaryCard("Maximum", fmtNum(column.numeric.max)) +
      summaryCard("Mean", fmtNum(column.numeric.mean)) +
      summaryCard("Median", fmtNum(column.numeric.median));
  }
  if (column.date) {
    stats += summaryCard("Earliest date", esc(column.date.earliest)) +
      summaryCard("Latest date", esc(column.date.latest)) +
      summaryCard("Span (days)", fmtNum(column.date.spanDays));
  }

  var frequency = "";
  if (column.topValues) {
    frequency = "<h4>Most frequent values</h4>" + renderFrequency(column.topValues) +
      (column.uniqueCount > column.topValues.length
        ? '<p class="hint">Showing the top ' + column.topValues.length + " of " + column.uniqueCount + " categories.</p>"
        : "");
  }

  return "<h3>" + esc(column.name) + " " + typeBadge(column.type) + "</h3>" +
    "<p>" + esc(TYPE_EXPLANATIONS[column.type]) + " " +
    esc(column.missingCount + " of " + rowCount + " cells are missing.") + "</p>" +
    (notes.length ? '<div class="notice">' + listHtml(notes) + "</div>" : "") +
    '<div class="card-grid compact">' + stats + "</div>" + frequency;
}

function renderColumnExplorer(report) {
  var options = report.columns.map(function (c) {
    return '<option value="' + c.index + '"' + (c.index === appState.selectedColumn ? " selected" : "") + ">" +
      esc(c.name) + "</option>";
  }).join("");
  return '<div class="select-row"><label for="columnSelect">Inspect a column:</label>' +
    '<select id="columnSelect">' + options + "</select></div>" +
    '<div class="card" id="columnDetail">' + renderColumnDetail(report.columns[appState.selectedColumn], report.rowCount) + "</div>" +
    "<h3>All columns</h3>" + '<p class="hint">Select a row to inspect that column.</p>' + renderColumnTable(report);
}

function renderNumerical(report) {
  var numeric = report.columns.filter(function (c) { return c.type === "numeric"; });
  var dates = report.columns.filter(function (c) { return c.type === "date"; });
  var html = "";

  if (numeric.length === 0) {
    html += emptyState("No numerical columns were detected in this dataset.");
  } else {
    var rows = numeric.map(function (c) {
      var s = c.numeric;
      return "<tr><td>" + esc(c.name) + '</td><td class="num">' + fmtNum(s.count) + '</td><td class="num">' + fmtNum(s.min) +
        '</td><td class="num">' + fmtNum(s.max) + '</td><td class="num">' + fmtNum(s.mean) +
        '</td><td class="num">' + fmtNum(s.median) + '</td><td class="num">' + fmtNum(s.sum) + "</td></tr>";
    }).join("");
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Column</th><th>Count</th><th>Minimum</th>' +
      "<th>Maximum</th><th>Mean</th><th>Median</th><th>Sum</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<p class="hint">Count is the number of non-missing values. Values are rounded to ' + DECIMALS +
      " decimals. Columns such as IDs are also numerical, so read their statistics with care.</p>";
  }

  if (dates.length > 0) {
    var dateRows = dates.map(function (c) {
      return "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.date.earliest) + "</td><td>" + esc(c.date.latest) +
        '</td><td class="num">' + fmtNum(c.date.spanDays) + "</td></tr>";
    }).join("");
    html += "<h3>Date columns</h3>" + '<div class="table-wrap"><table class="data-table"><thead><tr><th>Column</th>' +
      "<th>Earliest</th><th>Latest</th><th>Span (days)</th></tr></thead><tbody>" + dateRows + "</tbody></table></div>";
  }
  return html;
}

function renderFrequency(topValues) {
  var maxPercent = Math.max.apply(null, topValues.map(function (t) { return t.percent; }));
  return '<div class="freq-list">' + topValues.map(function (t) {
    return '<div class="freq-row"><span class="freq-label" title="' + esc(t.value) + '">' + esc(t.value) +
      '</span><span class="freq-bar"><span style="width:' + (maxPercent === 0 ? 0 : (100 * t.percent / maxPercent)) +
      '%"></span></span><span class="freq-count">' + fmtNum(t.count) + " (" + fmtPct(t.percent) + ")</span></div>";
  }).join("") + "</div>";
}

function renderCategorical(report) {
  var categorical = report.columns.filter(function (c) { return c.type === "categorical"; });
  if (categorical.length === 0) {
    return emptyState("No categorical columns were detected in this dataset.");
  }
  return '<div class="two-col">' + categorical.map(function (c) {
    var flags = "";
    if (c.highCardinality) { flags += ' <span class="badge status-attention">Possible high cardinality</span>'; }
    if (c.mixedType) { flags += ' <span class="badge status-attention">Possible mixed type</span>'; }
    var note = c.highCardinality
      ? '<p class="hint">This column has more than ' + HIGH_CARDINALITY_THRESHOLD +
        " unique values. That is not automatically a problem, but it may need extra consideration during preprocessing or encoding.</p>"
      : "";
    return '<div class="card"><h3>' + esc(c.name) + flags + "</h3>" +
      "<p><strong>Unique categories:</strong> " + fmtNum(c.uniqueCount) +
      " &nbsp; <strong>Missing:</strong> " + fmtNum(c.missingCount) + "</p>" +
      renderFrequency(c.topValues) +
      (c.uniqueCount > c.topValues.length
        ? '<p class="hint">Showing the top ' + c.topValues.length + " of " + c.uniqueCount + " categories.</p>" : "") +
      note + "</div>";
  }).join("") + "</div>";
}

function renderQuality(report) {
  var checks = report.checks.map(function (c) {
    return '<div class="check-row"><span class="check-label">' + esc(c.label) + "</span>" + statusBadge(c.status) +
      '<span class="check-detail">' + esc(c.detail) + "</span></div>";
  }).join("");

  var missingColumns = report.columns.filter(function (c) { return c.missingCount > 0; });
  var missingHtml;
  if (missingColumns.length === 0) {
    missingHtml = '<p class="good">No missing values were detected.</p>';
  } else {
    missingHtml = '<div class="freq-list">' + missingColumns.map(function (c) {
      return '<div class="freq-row"><span class="freq-label">' + esc(c.name) +
        '</span><span class="freq-bar warn"><span style="width:' + c.missingPercent +
        '%"></span></span><span class="freq-count">' + fmtNum(c.missingCount) + " (" + fmtPct(c.missingPercent) + ")</span></div>";
    }).join("") + "</div>" +
      '<p class="hint">Missing values are present. Review an appropriate handling strategy before model training. ' +
      "Nothing has been deleted or replaced.</p>";
  }

  var dup = report.duplicates;
  var dupHtml;
  if (dup.count === 0) {
    dupHtml = '<p class="good">No duplicate rows were detected.</p>';
  } else {
    var shown = dup.rowNumbers.slice(0, 10).join(", ") + (dup.rowNumbers.length > 10 ? ", ..." : "");
    dupHtml = "<p><strong>Duplicate rows:</strong> " + fmtNum(dup.count) + "</p>" +
      "<p><strong>Data row numbers (header not counted):</strong> " + esc(shown) + "</p>" +
      '<p class="hint">Duplicate rows were detected. Review them before model training. Nothing has been removed.</p>';
  }

  return '<div class="card"><h3>Quality checks</h3><div class="checks">' + checks + "</div></div>" +
    '<div class="two-col"><div class="card"><h3>Missing values by column</h3>' + missingHtml + "</div>" +
    '<div class="card"><h3>Duplicate rows</h3>' + dupHtml + "</div></div>";
}

function renderReadiness(report) {
  var r = report.readiness;
  return '<div class="notice strong">This is an initial inspection of the dataset. It is not a guarantee that the dataset is ' +
    "ready for machine learning, and it does not say that the dataset is &ldquo;good&rdquo; or &ldquo;bad&rdquo;.</div>" +
    '<div class="two-col">' +
    '<div class="card"><h3>Dataset status</h3><p class="tag">Observed facts</p>' + listHtml(r.status) + "</div>" +
    '<div class="card"><h3>Structure</h3><p class="tag">Observed facts</p>' + listHtml(r.structure) + "</div>" +
    '<div class="card"><h3>Data quality</h3><p class="tag">Observed facts</p>' + listHtml(r.dataQuality) + "</div>" +
    '<div class="card"><h3>Preparation notes</h3><p class="tag suggestion">Suggestions to review</p>' +
    listHtml(r.preparationNotes) + "</div></div>";
}

/* ---------- page control ---------- */

function setSectionContent(id, html) {
  document.getElementById(id).innerHTML = html;
}

function showStatus(message, kind) {
  var box = document.getElementById("loadStatus");
  box.className = "status-box " + (kind || "");
  box.textContent = message;
}

function resetResults() {
  appState.report = null;
  var placeholders = {
    overviewContent: "Select a dataset above to see the overview.",
    columnsContent: "Select a dataset above to explore its columns.",
    numericalContent: "Select a dataset above to see numerical statistics.",
    categoricalContent: "Select a dataset above to see categorical analysis.",
    qualityContent: "Select a dataset above to see the quality checks.",
    readinessContent: "Select a dataset above to see the AI readiness overview."
  };
  Object.keys(placeholders).forEach(function (id) {
    setSectionContent(id, emptyState(placeholders[id]));
  });
}

function renderReport(report, sourceLabel) {
  appState.report = report;
  appState.selectedColumn = 0;
  setSectionContent("overviewContent", renderOverview(report, sourceLabel));
  setSectionContent("columnsContent", renderColumnExplorer(report));
  setSectionContent("numericalContent", renderNumerical(report));
  setSectionContent("categoricalContent", renderCategorical(report));
  setSectionContent("qualityContent", renderQuality(report));
  setSectionContent("readinessContent", renderReadiness(report));
}

function selectColumn(index) {
  var report = appState.report;
  if (!report || !report.columns[index]) { return; }
  appState.selectedColumn = index;
  document.getElementById("columnSelect").value = String(index);
  document.getElementById("columnDetail").innerHTML = renderColumnDetail(report.columns[index], report.rowCount);
  Array.prototype.forEach.call(document.querySelectorAll("#columnsContent tr.selectable"), function (row) {
    row.classList.toggle("selected", Number(row.getAttribute("data-index")) === index);
  });
}

// Common path for sample files and uploaded files.
function analyseText(name, text, sourceLabel) {
  try {
    var dataset = loadDatasetFromText(name, text);
    var report = analyzeDataset(dataset);
    renderReport(report, sourceLabel);
    showStatus("Loaded " + name + ": " + report.rowCount + " rows, " + report.columnCount +
      " columns. Scroll down to read the report.", "success");
    document.getElementById("overview").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    resetResults();
    if (error instanceof DatasetError) {
      showStatus(error.message, "error");
    } else {
      showStatus("Something unexpected went wrong while analysing this file.", "error");
      if (window.console) { console.error(error); }
    }
  }
}

function loadSample(file) {
  showStatus("Loading " + file + " ...", "");

  // If pre-bundled data is available in memory, load it directly without network dependency
  if (typeof SAMPLE_DATA_FALLBACK !== "undefined" && SAMPLE_DATA_FALLBACK[file]) {
    analyseText(file, SAMPLE_DATA_FALLBACK[file], "Sample dataset");
    return;
  }

  var isWebSubdir = (typeof window !== "undefined" && window.location && (window.location.pathname.indexOf("/web/") !== -1 || window.location.pathname.endsWith("/web")));
  var path = (isWebSubdir ? "../data/" : "data/") + file;

  fetch(path)
    .then(function (response) {
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      return response.text();
    })
    .then(function (text) {
      analyseText(file, text, "Sample dataset");
    })
    .catch(function (err) {
      resetResults();
      var isFileProtocol = (typeof window !== "undefined" && window.location && window.location.protocol === "file:");
      if (isFileProtocol) {
        showStatus("Could not load '" + file + "'. When opening files locally via file://, browsers block file fetching for security. Please upload your CSV file using 'Choose CSV File' below, or run a local web server (e.g. python -m http.server 8000).", "error");
      } else {
        showStatus("The sample file '" + file + "' could not be loaded. Please ensure data/" + file + " exists or upload your CSV file below.", "error");
      }
      if (window.console) { console.error(err); }
    });
}

function handleUpload(file) {
  if (!file) { return; }
  if (!/\.csv$/i.test(file.name)) {
    resetResults();
    showStatus("Unsupported file: please choose a file whose name ends with .csv.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    resetResults();
    showStatus("This file is larger than 5 MB. Please choose a smaller CSV file.", "error");
    return;
  }
  var reader = new FileReader();
  reader.onload = function () { analyseText(file.name, String(reader.result), "Uploaded file"); };
  reader.onerror = function () {
    resetResults();
    showStatus("The file could not be read. Please try again.", "error");
  };
  reader.readAsText(file, "UTF-8");
}

function renderSampleCards() {
  document.getElementById("sampleList").innerHTML = SAMPLE_DATASETS.map(function (s) {
    return '<button type="button" class="card sample-card" data-file="' + esc(s.file) + '">' +
      '<strong>' + esc(s.title) + '</strong>' +
      '<span class="file-name">' + esc(s.file) + '</span>' +
      '<span class="sample-desc">' + esc(s.description) + '</span>' +
      '<span class="tag-row">' + s.tags.map(function (t) { return '<span class="badge badge-info">' + esc(t) + '</span>'; }).join("") + '</span>' +
      '<span class="demo-label">Click to explore dataset</span></button>';
  }).join("");
}

function initInterface() {
  renderSampleCards();
  resetResults();

  document.getElementById("sampleList").addEventListener("click", function (event) {
    var card = event.target.closest(".sample-card");
    if (!card) { return; }
    Array.prototype.forEach.call(document.querySelectorAll(".sample-card"), function (c) { c.classList.remove("active"); });
    card.classList.add("active");
    loadSample(card.getAttribute("data-file"));
  });

  var fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", function (event) {
      Array.prototype.forEach.call(document.querySelectorAll(".sample-card"), function (c) { c.classList.remove("active"); });
      handleUpload(event.target.files[0]);
      event.target.value = ""; // allows choosing the same file again
    });
  }

  var uploadCard = document.querySelector(".upload-card");
  if (uploadCard) {
    ["dragenter", "dragover"].forEach(function (eventName) {
      uploadCard.addEventListener(eventName, function (e) {
        e.preventDefault();
        e.stopPropagation();
        uploadCard.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach(function (eventName) {
      uploadCard.addEventListener(eventName, function (e) {
        e.preventDefault();
        e.stopPropagation();
        uploadCard.classList.remove("drag-over");
      });
    });
    uploadCard.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        Array.prototype.forEach.call(document.querySelectorAll(".sample-card"), function (c) { c.classList.remove("active"); });
        handleUpload(dt.files[0]);
      }
    });
  }

  var columnsSection = document.getElementById("columnsContent");
  if (columnsSection) {
    columnsSection.addEventListener("click", function (event) {
      var row = event.target.closest("tr.selectable");
      if (row) { selectColumn(Number(row.getAttribute("data-index"))); }
    });
    columnsSection.addEventListener("keydown", function (event) {
      var row = event.target.closest("tr.selectable");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectColumn(Number(row.getAttribute("data-index")));
      }
    });
    columnsSection.addEventListener("change", function (event) {
      if (event.target.id === "columnSelect") { selectColumn(Number(event.target.value)); }
    });
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initInterface);
}
