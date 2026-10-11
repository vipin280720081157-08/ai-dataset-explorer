# =====================================================================
# AI Dataset Explorer - R analysis workflow
#
# Run from the project folder:
#   Rscript R/main.R                         # analyse every CSV in data/
#   Rscript R/main.R data/movies_demo.csv    # analyse one CSV file
#
# Inside RStudio: set the working directory to the project folder, then
#   source("R/main.R")
#
# This script shows the whole workflow step by step. The analysis itself
# lives in R/functions.R. No packages are needed.
# =====================================================================

# Finds the project folder (the one that contains R/functions.R)
find_project_root <- function() {
  candidates <- character(0)
  file_argument <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (length(file_argument) > 0) {
    script_path <- normalizePath(sub("^--file=", "", file_argument[1]), mustWork = FALSE)
    candidates <- c(candidates, dirname(dirname(script_path)))
  }
  candidates <- c(candidates, getwd())

  for (candidate in candidates) {
    if (file.exists(file.path(candidate, "R", "functions.R"))) {
      return(candidate)
    }
  }
  stop("Could not find R/functions.R. Please run this script from the project folder.", call. = FALSE)
}

project_root <- find_project_root()
source(file.path(project_root, "R", "functions.R"))


# Runs the complete workflow for one CSV file and prints the report
explore_dataset <- function(file_path) {
  cat("\n", strrep("=", 72), "\n", sep = "")
  cat("AI DATASET EXPLORER - R analysis of:", basename(file_path), "\n")
  cat(strrep("=", 72), "\n", sep = "")

  # Step 1: read the dataset (stops with a friendly message if it is unusable)
  dataset <- load_dataset(file_path)

  # Step 2: analyse structure, column types, duplicates
  profiles <- profile_columns(dataset)
  duplicates <- find_duplicate_rows(dataset)
  overview <- summarize_overview(dataset, profiles, duplicates)

  # ---- Dataset overview ----
  print_heading("1. Dataset overview")
  cat("Dataset                      :", overview$name, "\n")
  cat("Rows                         :", format_whole_number(overview$rows), "\n")
  cat("Columns                      :", format_whole_number(overview$columns), "\n")
  cat("Total cells                  :", format_whole_number(overview$total_cells), "\n")
  cat("Numerical columns            :", overview$numeric_columns, "\n")
  cat("Categorical columns          :", overview$categorical_columns, "\n")
  cat("Date columns                 :", overview$date_columns, "\n")
  cat("Columns with missing values  :", length(overview$columns_with_missing), "\n")
  cat("Missing cells                :", format_whole_number(overview$total_missing_cells), "\n")
  cat("Duplicate rows               :", format_whole_number(overview$duplicate_rows), "\n")

  # ---- Column explorer ----
  print_heading("2. Column explorer (type, values, missing, unique)")
  print(profiles[, c("column", "type", "value_count", "missing_count", "missing_percent", "unique_count")],
        row.names = FALSE)
  notes <- character(0)
  for (i in seq_len(nrow(profiles))) {
    if (profiles$all_unique[i]) {
      notes <- c(notes, paste0(profiles$column[i], ": every value is different (it may be an identifier)."))
    }
  }
  if (length(notes) > 0) {
    cat("\nNotes:\n")
    print_bullets(notes)
  }

  # ---- Missing values ----
  print_heading("3. Missing value analysis")
  missing_values <- analyze_missing_values(profiles)
  if (nrow(missing_values) == 0) {
    cat("No missing values were detected.\n")
  } else {
    print(missing_values, row.names = FALSE)
    cat("\nMissing values are present. Review an appropriate handling strategy before model training.\n")
    cat("Nothing has been deleted or replaced.\n")
  }

  # ---- Duplicate rows ----
  print_heading("4. Duplicate row analysis")
  if (duplicates$count == 0) {
    cat("No duplicate rows were detected.\n")
  } else {
    cat("Duplicate rows:", duplicates$count, "\n")
    shown_rows <- head(duplicates$row_numbers, 10)
    cat("Data row numbers (header not counted):", paste(shown_rows, collapse = ", "),
        if (length(duplicates$row_numbers) > 10) ", ..." else "", "\n")
    cat("Duplicate rows were detected. Review them before model training. Nothing has been removed.\n")
  }

  # ---- Numerical analysis ----
  print_heading("5. Numerical analysis")
  numeric_summary <- summarize_numeric_columns(dataset, profiles)
  if (is.null(numeric_summary)) {
    cat("No numerical columns were detected in this dataset.\n")
  } else {
    print(numeric_summary, row.names = FALSE)
  }
  date_summary <- summarize_date_columns(dataset, profiles)
  if (!is.null(date_summary)) {
    cat("\nDate columns:\n")
    print(date_summary, row.names = FALSE)
  }

  # ---- Categorical analysis ----
  print_heading("6. Categorical analysis")
  categorical_summary <- summarize_categorical_columns(dataset, profiles)
  if (is.null(categorical_summary)) {
    cat("No categorical columns were detected in this dataset.\n")
  } else {
    for (item in categorical_summary) {
      flags <- character(0)
      if (item$high_cardinality) flags <- c(flags, "possible high cardinality")
      if (item$mixed_type) flags <- c(flags, "possible mixed type")
      cat("\nColumn:", item$column, "| unique categories:", item$unique_count,
          "| missing:", item$missing_count, "\n")
      if (length(flags) > 0) {
        cat("  Flags:", paste(flags, collapse = ", "), "\n")
      }
      print(item$top_values, row.names = FALSE)
      if (item$unique_count > nrow(item$top_values)) {
        cat("  (top", nrow(item$top_values), "of", item$unique_count, "categories shown)\n")
      }
      if (item$high_cardinality) {
        cat("  Many unique values are not automatically a problem, but may need extra consideration\n")
        cat("  during preprocessing or encoding.\n")
      }
    }
  }

  # ---- Dataset quality checks ----
  print_heading("7. Dataset quality checks")
  checks <- build_quality_checks(overview, profiles)
  for (i in seq_len(nrow(checks))) {
    cat(sprintf("%-22s %-10s %s\n", checks$check[i], checks$status[i], checks$detail[i]))
  }

  # ---- AI readiness overview ----
  print_heading("8. AI readiness overview")
  cat("(An initial inspection only - not a guarantee that the dataset is ready for AI/ML.)\n")
  readiness <- build_readiness_observations(overview, profiles)
  cat("\nDataset Status [observed facts]\n")
  print_bullets(readiness$status)
  cat("\nStructure [observed facts]\n")
  print_bullets(readiness$structure)
  cat("\nData Quality [observed facts]\n")
  print_bullets(readiness$data_quality)
  cat("\nPreparation Notes [suggestions to review]\n")
  print_bullets(readiness$preparation_notes)

  invisible(NULL)
}


# ---------------------------------------------------------------------
# Main: which files to analyse?
# ---------------------------------------------------------------------
csv_files <- commandArgs(trailingOnly = TRUE)
if (length(csv_files) == 0) {
  csv_files <- list.files(file.path(project_root, "data"), pattern = "\\.csv$", full.names = TRUE)
}
if (length(csv_files) == 0) {
  cat("No CSV files were found in the data/ folder.\n")
}

for (csv_file in csv_files) {
  tryCatch(
    explore_dataset(csv_file),
    error = function(error) {
      cat("\nCould not analyse", csv_file, "\n")
      cat("Reason:", conditionMessage(error), "\n")
    }
  )
}
