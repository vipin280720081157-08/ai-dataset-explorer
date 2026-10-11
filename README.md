# AI Dataset Explorer

[![R](https://img.shields.io/badge/R-4.0%2B-276DC3?logo=r&logoColor=white)](https://www.r-project.org/)
[![Base R](https://img.shields.io/badge/Dependencies-Base%20R-blue)](#)
[![JavaScript](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)](#)

A lightweight, non-destructive Exploratory Data Analysis (EDA) and data quality inspection tool built with **Base R** and an interactive, zero-dependency **HTML/CSS/JS** web interface.

The application analyzes CSV datasets prior to machine learning modeling—detecting data types, missing value distributions, duplicate records, high-cardinality attributes, and summary statistics to provide actionable AI readiness recommendations.

---

## Key Features

- **Automated Dataset Profiling**: Detects dataset dimensions (rows, columns, total cells), data types, and null value counts without altering source data.
- **Smart Type Inference**: Automatically classifies attributes into Numerical, Categorical, Date (ISO-8601), and Empty columns.
- **Descriptive Statistics**: Calculates count, minimum, maximum, mean, median, sum, and span for numerical and temporal fields.
- **Categorical Frequency Analysis**: Computes top-N category distributions with relative percentages and flags high-cardinality attributes.
- **Data Quality Audit**: Identifies missing values, exact duplicate rows, and mixed-type columns.
- **AI/ML Readiness Checklist**: Provides objective observations on preprocessing steps (imputation, encoding, scaling, identifier removal) needed prior to model training.
- **Zero Heavy Dependencies**: Runs on standard Base R without external packages, and on vanilla JavaScript without third-party web frameworks.

---

## Repository Structure

```
ai-dataset-explorer/
├── R/
│   ├── main.R            # CLI execution pipeline
│   └── functions.R       # Modular analysis and profiling functions
├── data/                 # Curated sample CSV datasets
│   ├── customers_demo.csv
│   ├── movies_demo.csv
│   ├── products_demo.csv
│   └── weather_demo.csv
├── docs/                 # Documentation and architecture diagrams
│   └── AI Dataset Explorer Block Diagram.png
├── tests/
│   └── test-cases.md     # Test suite and reference values
├── web/                  # Web application assets
│   ├── index.html        # Web app alternate entrypoint
│   ├── script.js         # Client-side analysis engine and UI logic
│   └── style.css         # Responsive stylesheet
├── index.html            # Main web application entrypoint
├── .gitignore            # Git ignore rules
└── README.md             # Project documentation
```

---

## Getting Started

### Option 1: Interactive Web Application

Open `index.html` directly in any modern web browser, or serve it locally:

```bash
# Optional: run a local HTTP server
python -m http.server 8000
```

Open `http://localhost:8000` in your browser. You can select any bundled sample dataset or upload your own CSV file. All processing is performed entirely client-side in the browser.

### Option 2: Base R Command-Line Pipeline

Run the analysis pipeline from your terminal or R console:

```bash
# Analyze all sample datasets in data/
Rscript R/main.R

# Analyze a specific CSV dataset
Rscript R/main.R data/customers_demo.csv
```

Or execute within an R session:

```r
source("R/main.R")
```

---

## Sample Datasets Included

| Dataset | Rows | Columns | Key Characteristics |
|---|---|---|---|
| `customers_demo.csv` | 40 | 7 | Numerical, categorical, date fields, missing values |
| `movies_demo.csv` | 30 | 7 | Numerical ratings, duplicate rows, complete records |
| `products_demo.csv` | 36 | 8 | High cardinality (`product_name`), mixed types (`stock_quantity`, `weight_kg`) |
| `weather_demo.csv` | 30 | 6 | Multi-city climate time series, complete records |

---

## License

This project is licensed under the [MIT License](LICENSE).
