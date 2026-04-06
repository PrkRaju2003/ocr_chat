# Automated Math Problem Recognition and Solver (ocr_text)

An end-to-end OCR solution designed to recognize complex mathematical symbols and formulas from images or PDFs and convert them into clean, editable LaTeX code.

## 🌟 Key Features

**Multi-Format Support:** Process standard image formats (PNG, JPG, JPEG, GIF, WebP) or multi-page PDF documents[cite: 32].
**Interactive Selection:** Use an integrated drawable canvas to draw precise bounding boxes around specific equations[cite: 32].
**Intelligent OCR Engine:** Powered by the `ocr_text` model, which utilizes the **Donut-OCR architecture** and was trained on the **Harvard im2latex dataset**[cite: 31].
**Web-Based Interface:** Built using **Streamlit** for a seamless, user-friendly experience[cite: 32].
**Real-time Conversion:** Instantly converts selected regions into Markdown and raw LaTeX code for immediate use[cite: 32].

## 🛠️ Technology Stack

- **Frontend:** Streamlit
- **UI Components:** Streamlit Drawable Canvas
- **Core Language:** Python
- **OCR Architecture:** Donut (via ocr_text)
- **Data Handling:** Pandas, PIL (Pillow), PyPDFium2
- **Formatting:** LaTeX / KaTeX

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- `ocr_text` library and associated model weights

### Installation

1. **Clone the repository:**

   ```bash
   git clone [https://github.com/PrkRaju2003/Automated-Math-Recognition.git](https://github.com/PrkRaju2003/texify.git)
   cd texify

   pip install streamlit pandas streamlit-drawable-canvas pypdfium2 pillow ocr_text

   streamlit run app.py

   📖 How to Use
   Upload: Use the sidebar to upload a PDF or image file.
   ```

Navigate (PDF only): Use the page number input to find the correct page.

Select: Draw a box (rectangle) around the mathematical expression you want to solve.

Adjust: If needed, adjust the Generation Temperature in the sidebar. Lower values (near 0.0) are more deterministic, while higher values allow for more "creative" interpretation by the model.

Output: The rendered math appears in the right-hand column along with the raw LaTeX code.

Role: Team Leader
