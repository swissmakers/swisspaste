// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Load the locally bundled PDF renderer only when a PDF preview is opened
import { GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
GlobalWorkerOptions.workerSrc = "/static/pdf.worker.js";
export { getDocument } from "pdfjs-dist/build/pdf.mjs";
