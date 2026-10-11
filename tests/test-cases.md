# Test Cases – AI Dataset Explorer

This file lists practical test cases for the R analysis and the website.
It contains **expected behaviour** and **what to check**. The *Result* column is
intentionally empty: fill it in yourself (Pass / Fail / notes) after you run each test.

## How to run the tests

**R analysis** (from the project folder):

```
Rscript R/main.R                         # all sample datasets
Rscript R/main.R data/movies_demo.csv    # one dataset
```

**Website** (from the project folder):

```
python -m http.server 8000
```

then open `http://localhost:8000/web/` and click a sample dataset.

For most cases below, run **both** and confirm that R and the website give the same numbers
(see *TC-14*).

## Reference values for the sample datasets

These values were calculated for the four included sample datasets and are the numbers
you should expect to see (percentages and statistics rounded to 2 decimals).

| Dataset | Rows | Columns | Numerical | Categorical | Date | Columns with missing values | Missing cells | Duplicate rows |
|---|---|---|---|---|---|---|---|---|
| customers_demo.csv | 40 | 7 | 3 | 3 | 1 | 4 (age, city, annual_spend, signup_date) | 14 | 0 |
| movies_demo.csv | 30 | 7 | 4 | 3 | 0 | 0 | 0 | 2 (data rows 29, 30) |
| products_demo.csv | 36 | 8 | 3 | 5 | 0 | 1 (rating) | 5 | 0 |
| weather_demo.csv | 30 | 6 | 3 | 2 | 1 | 0 | 0 | 0 |

Other flags:

| Dataset | High-cardinality columns | Mixed-type columns |
|---|---|---|
| customers_demo.csv | none | none |
| movies_demo.csv | none | none |
| products_demo.csv | product_name (36 unique values) | stock_quantity, weight_kg |
| weather_demo.csv | none | none |

Numerical statistics (count, minimum, maximum, mean, median, sum):

| Dataset | Column | Count | Min | Max | Mean | Median | Sum |
|---|---|---|---|---|---|---|---|
| customers_demo.csv | age | 35 | 21 | 64 | 40.66 | 44 | 1423 |
| customers_demo.csv | annual_spend | 36 | 969 | 9409 | 5056.56 | 4668 | 182036 |
| movies_demo.csv | rating | 30 | 4.3 | 9 | 6.44 | 6.2 | 193.3 |
| movies_demo.csv | duration_minutes | 30 | 81 | 164 | 121.6 | 117 | 3648 |
| products_demo.csv | price | 36 | 625.9 | 4526.08 | 2628.2 | 2824.72 | 94615.19 |
| products_demo.csv | rating | 31 | 2.8 | 4.9 | 3.92 | 3.9 | 121.4 |
| weather_demo.csv | temperature_c | 30 | 22.2 | 35.7 | 29.04 | 28.3 | 871.3 |
| weather_demo.csv | humidity_pct | 30 | 47 | 90 | 67.03 | 64 | 2011 |
| weather_demo.csv | rainfall_mm | 30 | 0 | 35.6 | 2.5 | 0 | 75 |

Date columns: `signup_date` (customers) – earliest 2022-02-02, latest 2024-06-09, span 858 days;
`date` (weather) – earliest 2024-06-01, latest 2024-06-10, span 9 days.

## Test cases

| ID | Test | Dataset / input | What to do | Expected behaviour | What to check | Result |
|---|---|---|---|---|---|---|
| TC-01 | Dataset with numerical columns | customers_demo.csv | Load it in R and on the website. | `customer_id`, `age`, `annual_spend` are detected as **Numerical**. Overview shows 3 numerical columns. | Type column in the column table; numerical count card. | |
| TC-02 | Dataset with categorical columns | customers_demo.csv | Open the categorical analysis. | `gender`, `city`, `membership` are **Categorical**. Overview shows 3 categorical columns. Each has a frequency table. | Unique counts: gender 2, city 6, membership 3. | |
| TC-03 | Dataset containing missing values | customers_demo.csv | Open Data Quality (website) / section 3 (R). | 14 missing cells in 4 columns. Missing Values check shows **Attention**. A note says missing values should be reviewed; nothing is deleted. | age 5 (12.5 %), city 3 (7.5 %), annual_spend 4 (10 %), signup_date 2 (5 %). | |
| TC-04 | Dataset with no missing values | weather_demo.csv | Open Data Quality / section 3. | "No missing values were detected." Missing Values check shows **OK – None detected**. | No missing-value bars on the website. | |
| TC-05 | Dataset containing duplicate rows | movies_demo.csv | Open the duplicate analysis. | 2 duplicate rows detected, at data rows 29 and 30 (header not counted). Duplicate Rows check shows **Attention**. A note says to review them; nothing is removed. | Count = 2 and row numbers 29, 30. | |
| TC-06 | Dataset with no duplicates | weather_demo.csv | Open the duplicate analysis. | "No duplicate rows were detected." Check shows **OK**. | Count = 0. | |
| TC-07 | High-cardinality categorical column | products_demo.csv | Open Categorical analysis. | `product_name` (36 unique values) is flagged **Possible high cardinality** with a note that it is not automatically a problem. High Cardinality check shows **Attention**. | Only `product_name` is flagged; `category` (4) and `brand` (4) are not. | |
| TC-08 | Mixed data types | products_demo.csv | Open the column explorer for `weight_kg` and `stock_quantity`. | Both are treated as **Categorical** because they contain text values (`unknown`, `out of stock`) among numbers, and are flagged **Possible mixed type**. | Mixed-Type Columns check lists both; they are *not* listed as high cardinality. | |
| TC-09 | Empty / invalid dataset | See *Invalid input files* below. | Try each invalid file in R and on the website. | A friendly message is shown. R prints "Could not analyse … Reason: …"; the website shows a red message. No crash, no blank page. | Message wording matches the table below. | |
| TC-10 | Multiple sample datasets | All four samples | Load each one after the other (website) / run `Rscript R/main.R` (R). | Each dataset produces its own report; the website replaces the previous report each time. | Values match the reference tables above. | |
| TC-11 | Column inspection | products_demo.csv | Website: choose `rating` in the "Inspect a column" list and also click a row in the table. R: section 2. | Detail card shows type Numerical, 31 values, 5 missing, 13.89 %, 20 unique, plus min/max/mean/median. | Selecting a different column updates the card; the chosen row is highlighted. | |
| TC-12 | Numerical statistics | weather_demo.csv | Open Numerical analysis / section 5. | Count, minimum, maximum, mean, median and sum match the reference table. | e.g. `temperature_c` mean 29.04, median 28.3. | |
| TC-13 | Frequency-table analysis | customers_demo.csv | Open Categorical analysis / section 6. | `city` lists the top 5 of 6 categories with counts and percentages. First entries: Coimbatore 11 (29.73 %), Hyderabad 9 (24.32 %), Bengaluru 5 (13.51 %). | Percent is of non-missing values (37). "Top 5 of 6 categories" note appears. | |
| TC-14 | R and website give the same results | All four samples | Run both and compare overview numbers, column types, statistics and frequency tables. | Values are the same (numbers may be printed with different formatting, e.g. `1020.5` vs `1,020.5`). | Differences in the last decimal would need investigation. | |
| TC-15 | Unsupported file type | A file named `notes.txt` | Website: upload it. R: `Rscript R/main.R notes.txt`. | Message starting with "Unsupported file". | Nothing is analysed. | |
| TC-16 | Uploading your own CSV | Any small CSV you create | Website: choose the file with the upload button. | The full report appears and the dataset badge says "Uploaded file". | Numbers agree with R when you run the same file. | |
| TC-17 | Readiness wording | Any dataset | Open AI Readiness. | The page states it is an initial inspection and not a guarantee of readiness. Observed facts and suggestions are labelled separately. | No "good/bad" verdict and no score anywhere. | |

## Invalid input files

Create these small files yourself (any text editor, saved with the `.csv` extension unless stated)
and try them in R and on the website.

| File | Content | Expected message (start of text) |
|---|---|---|
| `empty.csv` | (nothing – a 0-byte file) | "The file is empty." |
| `header_only.csv` | `a,b,c` (one line only) | "The dataset has column names but no data rows" |
| `ragged.csv` | line 1 `a,b` · line 2 `1,2` · line 3 `3` | "Invalid CSV: data row 2 has 1 value(s) but the header has 2 column(s)." |
| `unclosed.csv` | line 1 `a,b` · line 2 `"1,2` | "Invalid CSV: a quotation mark was opened but never closed." |
| `notes.txt` | `a,b` then `1,2` | "Unsupported file" |
| `blank_name.csv` | line 1 `,b` · line 2 `1,x` (valid file) | Analysed normally; the first column is called `Unnamed_column_1`. |

## Notes for testers

* The website cannot load the sample datasets if `index.html` is opened by double-clicking it
  (the browser blocks file loading). Use the local web server, or GitHub Pages, or the upload button.
* Missing values are empty cells and the text `NA`, `N/A`, `NaN`, `NULL`, `null`.
* If you add your own test CSV, calculate the expected values by hand first, then compare.
