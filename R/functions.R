# =====================================================================
# AI Dataset Explorer - reusable analysis functions (base R only)
#
# These functions follow exactly the same rules as web/script.js, so the
# R analysis and the website give the same observations for the same CSV.
# No packages are needed.
# =====================================================================

# ---------------------------------------------------------------------
# Settings (the rules of the analysis)
# ---------------------------------------------------------------------

# Text values treated as "missing" (after trimming spaces)
MISSING_TOKENS <- c("", "NA", "N/A", "NaN", "NULL", "null")

# A categorical column with MORE unique values than this is flagged
HIGH_CARDINALITY_THRESHOLD <- 10

# Number of most frequent categories to list
TOP_N_CATEGORIES <- 5

# A text column is "mixed type" if at least this share of its non-missing
# values look like numbers (but not all of them)
MIXED_NUMERIC_SHARE <- 0.8

# Numbers are rounded to this many decimals
DECIMALS <- 2

# A number: optional sign, digits with optional decimal part, optional exponent
NUMBER_PATTERN <- "^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$"

# A date written as YYYY-MM-DD
DATE_PATTERN <- "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"


# ---------------------------------------------------------------------
# 1. Dataset loading
# ---------------------------------------------------------------------

# Runs some code and turns reading problems into friendly error messages.
with_csv_error_handling <- function(code) {
  tryCatch(
    withCallingHandlers(
      code,
      warning = function(w) {
        if (grepl("EOF within quoted string", conditionMessage(w), fixed = TRUE)) {
          stop("Invalid CSV: a quotation mark was opened but never closed.", call. = FALSE)
        }
        invokeRestart("muffleWarning")
      }
    ),
    error = function(e) {
      message_text <- conditionMessage(e)
      if (!startsWith(message_text, "Invalid CSV")) {
        message_text <- paste0("Invalid CSV: the file could not be read (", message_text, ")")
      }
      stop(message_text, call. = FALSE)
    }
  )
}

# Removes spaces around values and turns missing tokens into NA.
normalise_values <- function(values) {
  values <- trimws(as.character(values))
  values[values %in% MISSING_TOKENS] <- NA_character_
  values
}

# Blank names become Unnamed_column_N; repeated names get ".1", ".2", ...
prepare_column_names <- function(header) {
  header <- trimws(as.character(header))
  blank <- is.na(header) | header == ""
  header[blank] <- paste0("Unnamed_column_", which(blank))
  occurrence <- ave(seq_along(header), header, FUN = seq_along)
  ifelse(occurrence == 1, header, paste0(header, ".", occurrence - 1))
}

# Reads a CSV file. Every column is first read as text, so the type
# detection below is done by our own (documented) rules.
# Returns list(name, data). Stops with a friendly message if the file
# cannot be used.
load_dataset <- function(file_path) {
  if (!file.exists(file_path)) {
    stop("File not found: ", file_path, call. = FALSE)
  }
  if (!grepl("\\.csv$", file_path, ignore.case = TRUE)) {
    stop("Unsupported file: please provide a file whose name ends with .csv.", call. = FALSE)
  }

  lines <- with_csv_error_handling(readLines(file_path, warn = FALSE))
  file_is_blank <- length(lines) == 0 || with_csv_error_handling(all(trimws(lines) == ""))
  if (file_is_blank) {
    stop("The file is empty. Please use a CSV file with a header row and data rows.", call. = FALSE)
  }

  # Every row must have the same number of values as the header row
  field_counts <- with_csv_error_handling(
    count.fields(file_path, sep = ",", quote = "\"", blank.lines.skip = TRUE, comment.char = "")
  )
  # count.fields gives NA for a line inside a quoted text that continues on the
  # next line. If the LAST line is still NA, a quotation mark was never closed.
  if (length(field_counts) > 0 && is.na(field_counts[length(field_counts)])) {
    stop("Invalid CSV: a quotation mark was opened but never closed.", call. = FALSE)
  }
  field_counts <- field_counts[!is.na(field_counts)]
  if (any(field_counts != field_counts[1])) {
    first_bad <- which(field_counts != field_counts[1])[1]
    stop(sprintf(
      "Invalid CSV: data row %d has %d value(s) but the header has %d column(s).",
      first_bad - 1L, field_counts[first_bad], field_counts[1]
    ), call. = FALSE)
  }
  if (length(field_counts) == 1) {
    stop("The dataset has column names but no data rows, so there is nothing to analyse.", call. = FALSE)
  }

  raw_table <- with_csv_error_handling(
    read.csv(
      file_path, header = FALSE, colClasses = "character", na.strings = character(0),
      quote = "\"", comment.char = "", check.names = FALSE, stringsAsFactors = FALSE,
      blank.lines.skip = TRUE, fileEncoding = "UTF-8-BOM"
    )
  )

  header <- as.character(unlist(raw_table[1, ], use.names = FALSE))
  values_table <- raw_table[-1, , drop = FALSE]
  values_table[] <- lapply(values_table, normalise_values)
  names(values_table) <- prepare_column_names(header)
  rownames(values_table) <- NULL

  list(name = basename(file_path), data = values_table)
}


# ---------------------------------------------------------------------
# 2. Column type detection
# ---------------------------------------------------------------------

is_number_text <- function(values) {
  grepl(NUMBER_PATTERN, values)
}

# TRUE for real calendar dates written as YYYY-MM-DD
is_iso_date_text <- function(values) {
  looks_like_date <- grepl(DATE_PATTERN, values)
  parsed <- as.Date(ifelse(looks_like_date, values, NA_character_), format = "%Y-%m-%d")
  looks_like_date & !is.na(parsed)
}

# Returns "empty", "numeric", "date" or "categorical"
classify_column <- function(values) {
  present <- values[!is.na(values)]
  if (length(present) == 0) return("empty")
  if (all(is_number_text(present))) return("numeric")
  if (all(is_iso_date_text(present))) return("date")
  "categorical"
}


# ---------------------------------------------------------------------
# 3. Column profiles (type, missing values, unique values)
# ---------------------------------------------------------------------

percent_of <- function(part, whole) {
  if (whole == 0) return(0)
  round(100 * part / whole, DECIMALS)
}

# One row of information about one column
profile_one_column <- function(column_name, values, total_rows) {
  present <- values[!is.na(values)]
  type <- classify_column(values)
  unique_count <- length(unique(present))
  numeric_share <- if (length(present) == 0) 0 else sum(is_number_text(present)) / length(present)
  mixed_type <- type == "categorical" && numeric_share >= MIXED_NUMERIC_SHARE

  data.frame(
    column = column_name,
    type = type,
    value_count = length(present),
    missing_count = total_rows - length(present),
    missing_percent = percent_of(total_rows - length(present), total_rows),
    unique_count = unique_count,
    all_unique = length(present) > 1 && unique_count == length(present),
    mixed_type = mixed_type,
    high_cardinality = type == "categorical" && !mixed_type && unique_count > HIGH_CARDINALITY_THRESHOLD,
    stringsAsFactors = FALSE
  )
}

# Profiles every column -> one data frame, one row per column
profile_columns <- function(dataset) {
  table_data <- dataset$data
  profiles <- lapply(seq_along(table_data), function(i) {
    profile_one_column(names(table_data)[i], table_data[[i]], nrow(table_data))
  })
  do.call(rbind, profiles)
}


# ---------------------------------------------------------------------
# 4. Dataset overview
# ---------------------------------------------------------------------

summarize_overview <- function(dataset, profiles, duplicates) {
  total_rows <- nrow(dataset$data)
  total_columns <- ncol(dataset$data)
  list(
    name = dataset$name,
    rows = total_rows,
    columns = total_columns,
    total_cells = as.numeric(total_rows) * total_columns,
    numeric_columns = sum(profiles$type == "numeric"),
    categorical_columns = sum(profiles$type == "categorical"),
    date_columns = sum(profiles$type == "date"),
    empty_columns = sum(profiles$type == "empty"),
    columns_with_missing = profiles$column[profiles$missing_count > 0],
    total_missing_cells = sum(profiles$missing_count),
    duplicate_rows = duplicates$count
  )
}


# ---------------------------------------------------------------------
# 5. Missing values and duplicate rows
# ---------------------------------------------------------------------

# Only the columns that have missing values (0 rows if there are none)
analyze_missing_values <- function(profiles) {
  affected <- profiles[profiles$missing_count > 0, c("column", "missing_count", "missing_percent")]
  rownames(affected) <- NULL
  affected
}

# A row is a duplicate if an identical row appeared earlier.
# row_numbers are data row numbers (the header is not counted).
find_duplicate_rows <- function(dataset) {
  duplicate_flags <- duplicated(dataset$data)
  list(count = sum(duplicate_flags), row_numbers = which(duplicate_flags))
}


# ---------------------------------------------------------------------
# 6. Numerical and date analysis
# ---------------------------------------------------------------------

# Count, min, max, mean, median and sum for every numerical column
summarize_numeric_columns <- function(dataset, profiles) {
  numeric_names <- profiles$column[profiles$type == "numeric"]
  if (length(numeric_names) == 0) return(NULL)

  summaries <- lapply(numeric_names, function(column_name) {
    column_values <- dataset$data[[column_name]]
    numbers <- as.numeric(column_values[!is.na(column_values)])
    data.frame(
      column = column_name,
      count = length(numbers),
      min = round(min(numbers), DECIMALS),
      max = round(max(numbers), DECIMALS),
      mean = round(mean(numbers), DECIMALS),
      median = round(median(numbers), DECIMALS),
      sum = round(sum(numbers), DECIMALS),
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, summaries)
}

# Earliest date, latest date and span in days for every date column
summarize_date_columns <- function(dataset, profiles) {
  date_names <- profiles$column[profiles$type == "date"]
  if (length(date_names) == 0) return(NULL)

  summaries <- lapply(date_names, function(column_name) {
    column_values <- dataset$data[[column_name]]
    dates <- as.Date(column_values[!is.na(column_values)], format = "%Y-%m-%d")
    data.frame(
      column = column_name,
      earliest = format(min(dates)),
      latest = format(max(dates)),
      span_days = as.numeric(difftime(max(dates), min(dates), units = "days")),
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, summaries)
}


# ---------------------------------------------------------------------
# 7. Categorical analysis
# ---------------------------------------------------------------------

# Most frequent values first; ties are sorted A-Z (plain "C" ordering)
frequency_table <- function(values, top_n = TOP_N_CATEGORIES) {
  present <- values[!is.na(values)]
  counts <- table(present)
  frequencies <- data.frame(
    value = names(counts),
    count = as.integer(counts),
    stringsAsFactors = FALSE
  )
  frequencies <- frequencies[order(-frequencies$count, frequencies$value, method = "radix"), , drop = FALSE]
  frequencies$percent <- round(100 * frequencies$count / length(present), DECIMALS)
  rownames(frequencies) <- NULL
  head(frequencies, top_n)
}

# For every categorical column: unique count, flags and top values
summarize_categorical_columns <- function(dataset, profiles) {
  categorical_rows <- profiles[profiles$type == "categorical", ]
  if (nrow(categorical_rows) == 0) return(NULL)

  lapply(seq_len(nrow(categorical_rows)), function(i) {
    column_name <- categorical_rows$column[i]
    list(
      column = column_name,
      unique_count = categorical_rows$unique_count[i],
      missing_count = categorical_rows$missing_count[i],
      high_cardinality = categorical_rows$high_cardinality[i],
      mixed_type = categorical_rows$mixed_type[i],
      top_values = frequency_table(dataset$data[[column_name]])
    )
  })
}


# ---------------------------------------------------------------------
# 8. Dataset quality checks
# ---------------------------------------------------------------------

make_check <- function(check, status, detail) {
  data.frame(check = check, status = status, detail = detail, stringsAsFactors = FALSE)
}

# Simple, transparent checks. Status is "OK", "Attention" or "Info".
build_quality_checks <- function(overview, profiles) {
  high_cardinality_names <- profiles$column[profiles$high_cardinality]
  mixed_type_names <- profiles$column[profiles$mixed_type]
  has_missing <- overview$total_missing_cells > 0
  has_duplicates <- overview$duplicate_rows > 0

  rbind(
    make_check("Dataset Loaded", "OK", "Dataset loaded successfully."),
    make_check("Rows Present", if (overview$rows > 0) "OK" else "Attention",
               paste0("Rows found: ", overview$rows)),
    make_check("Columns Present", if (overview$columns > 0) "OK" else "Attention",
               paste0("Columns found: ", overview$columns)),
    make_check("Missing Values", if (has_missing) "Attention" else "OK",
               if (has_missing) {
                 paste0("Columns with missing values: ", length(overview$columns_with_missing),
                        " (", overview$total_missing_cells, " missing cells)")
               } else "None detected"),
    make_check("Duplicate Rows", if (has_duplicates) "Attention" else "OK",
               if (has_duplicates) paste0("Duplicate rows detected: ", overview$duplicate_rows) else "None detected"),
    make_check("Numerical Columns", if (overview$numeric_columns > 0) "OK" else "Info",
               if (overview$numeric_columns > 0) paste0("Detected: ", overview$numeric_columns) else "None detected"),
    make_check("Categorical Columns", if (overview$categorical_columns > 0) "OK" else "Info",
               if (overview$categorical_columns > 0) paste0("Detected: ", overview$categorical_columns) else "None detected"),
    make_check("High Cardinality", if (length(high_cardinality_names) > 0) "Attention" else "OK",
               if (length(high_cardinality_names) > 0) {
                 paste0("Detected: ", paste(high_cardinality_names, collapse = ", "))
               } else "None detected"),
    make_check("Mixed-Type Columns", if (length(mixed_type_names) > 0) "Attention" else "OK",
               if (length(mixed_type_names) > 0) {
                 paste0("Detected: ", paste(mixed_type_names, collapse = ", "))
               } else "None detected")
  )
}


# ---------------------------------------------------------------------
# 9. AI readiness observations
# ---------------------------------------------------------------------

# Summarises what the analysis found. This is NOT a verdict that the
# dataset is ready (or not ready) for AI/ML.
build_readiness_observations <- function(overview, profiles) {
  high_cardinality_names <- profiles$column[profiles$high_cardinality]
  mixed_type_names <- profiles$column[profiles$mixed_type]

  status <- paste0("Loaded successfully: ", overview$rows, " rows and ", overview$columns, " columns.")

  structure_notes <- c(
    if (overview$numeric_columns > 0) {
      paste0("Numerical columns detected (", overview$numeric_columns, ").")
    } else "No numerical columns detected.",
    if (overview$categorical_columns > 0) {
      paste0("Categorical columns detected (", overview$categorical_columns, ").")
    } else "No categorical columns detected.",
    if (overview$date_columns > 0) paste0("Date columns detected (", overview$date_columns, ").")
  )

  quality_notes <- c(
    if (overview$total_missing_cells > 0) {
      paste0("Missing values detected in ", length(overview$columns_with_missing),
             " column(s) (", overview$total_missing_cells, " cells).")
    } else "No missing values detected.",
    if (overview$duplicate_rows > 0) {
      paste0("Duplicate rows detected (", overview$duplicate_rows, ").")
    } else "No duplicate rows detected.",
    if (length(high_cardinality_names) > 0) {
      paste0("Possible high-cardinality categorical column(s): ",
             paste(high_cardinality_names, collapse = ", "), ".")
    },
    if (length(mixed_type_names) > 0) {
      paste0("Possible mixed-type column(s): ", paste(mixed_type_names, collapse = ", "), ".")
    }
  )

  preparation_notes <- c(
    if (overview$total_missing_cells > 0) {
      "Review missing values and choose an appropriate handling strategy before model training."
    },
    if (overview$duplicate_rows > 0) "Review duplicate rows before model training.",
    if (overview$categorical_columns > 0) "Review categorical encoding requirements before model training.",
    if (length(high_cardinality_names) > 0) {
      "Columns with many unique categories may need extra consideration during preprocessing or encoding."
    },
    if (length(mixed_type_names) > 0) {
      "Check whether mixed-type columns contain data-entry issues or intended text values."
    },
    if (overview$numeric_columns > 0) "Review numerical ranges (minimum and maximum) for unexpected values.",
    "This is an initial inspection only. It does not confirm that the dataset is ready for AI/ML use."
  )

  list(
    status = status,
    structure = structure_notes,
    data_quality = quality_notes,
    preparation_notes = preparation_notes
  )
}


# ---------------------------------------------------------------------
# 10. Printing helpers (used by main.R)
# ---------------------------------------------------------------------

# Formats a whole number without scientific notation (100000, not 1e+05)
format_whole_number <- function(value) {
  format(value, scientific = FALSE, trim = TRUE)
}

print_heading <- function(title) {
  cat("\n", title, "\n", strrep("-", nchar(title)), "\n", sep = "")
}

print_bullets <- function(lines) {
  for (line in lines) {
    cat(" -", line, "\n")
  }
}
