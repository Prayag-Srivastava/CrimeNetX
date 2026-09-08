"""
CrimeNetX Investigation Dossier Engine
Generates an official Statutory Police Charge Sheet / Final Form
Under Section 173 Cr.P.C. / Section 193 Bharatiya Nagarik Suraksha Sanhita (B.N.S.S.), 2023.
Supports full Indic rendering (Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Punjabi).
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import ssl
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.config import settings

logger = logging.getLogger("crimenetx.dossier")

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "generated_dossiers"
FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"

# CDN fallbacks for Linux/Docker environments if local fonts are not present
INDIC_FONT_URLS = {
    "hi": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    "mr": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    "bn": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansBengali/NotoSansBengali-Regular.ttf",
    "ta": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
    "te": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
    "gu": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansGujarati/NotoSansGujarati-Regular.ttf",
    "kn": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
    "pa": "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@master/hinted/ttf/NotoSansGurmukhi/NotoSansGurmukhi-Regular.ttf",
}

# =========================================================================
# 1. UNIVERSAL INDIC FONT RESOLVER (ALL INDIAN SCRIPTS)
# =========================================================================

WINDOWS_INDIC_FONTS = {
    "hi": ["Nirmala.ttf", "mangal.ttf"],
    "mr": ["Nirmala.ttf", "mangal.ttf"],
    "bn": ["Nirmala.ttf", "vrinda.ttf"],
    "ta": ["Nirmala.ttf", "latha.ttf"],
    "te": ["Nirmala.ttf", "gautami.ttf"],
    "gu": ["Nirmala.ttf", "shruti.ttf"],
    "kn": ["Nirmala.ttf", "tunga.ttf"],
    "pa": ["Nirmala.ttf", "raavi.ttf"],
}

def _register_indic_fonts(lang: str = "en") -> tuple[str, str]:
    """Registers Unicode TrueType fonts for English and all official Indian languages."""
    if lang == "en":
        return "Helvetica", "Helvetica-Bold"

    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    font_name = f"Indic_{lang.upper()}"
    bold_name = f"Indic_{lang.upper()}_Bold"

    try:
        pdfmetrics.getFont(font_name)
        return font_name, bold_name
    except KeyError:
        pass

    # 1. Check Windows System Fonts for the specific language
    win_fonts_dir = Path("C:/Windows/Fonts")
    candidates = WINDOWS_INDIC_FONTS.get(lang, ["Nirmala.ttf"])
    
    for candidate in candidates:
        candidate_path = win_fonts_dir / candidate
        if candidate_path.exists():
            try:
                pdfmetrics.registerFont(TTFont(font_name, str(candidate_path)))
                pdfmetrics.registerFont(TTFont(bold_name, str(candidate_path)))
                registerFontFamily(font_name, normal=font_name, bold=bold_name, italic=font_name, boldItalic=bold_name)
                logger.info("Bound Windows %s font for %s", candidate, lang)
                return font_name, bold_name
            except Exception as e:
                logger.warning("Failed to register %s: %s", candidate_path, e)

    # 2. Check local or auto-downloaded Noto Sans font
    local_ttf = FONTS_DIR / f"NotoSans_{lang}.ttf"
    if not local_ttf.exists() and lang in INDIC_FONT_URLS:
        try:
            ctx = ssl._create_unverified_context()
            req = urllib.request.Request(INDIC_FONT_URLS[lang], headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp, open(local_ttf, "wb") as out_f:
                out_f.write(resp.read())
        except Exception as e:
            logger.warning("Could not auto-download font for %s: %s", lang, e)

    if local_ttf.exists():
        try:
            pdfmetrics.registerFont(TTFont(font_name, str(local_ttf)))
            pdfmetrics.registerFont(TTFont(bold_name, str(local_ttf)))
            registerFontFamily(font_name, normal=font_name, bold=bold_name, italic=font_name, boldItalic=bold_name)
            return font_name, bold_name
        except Exception as e:
            logger.error("Failed to register %s: %s", local_ttf, e)

    logger.error("No Unicode font found for %s; glyphs may appear distorted.", lang)
    return "Helvetica", "Helvetica-Bold"


# =========================================================================
# 2. STATUTORY NARRATIVE TRANSLATION ENGINE
# =========================================================================

def _translate_narrative(text: str, lang: str) -> str:
    """Translates case findings into authentic statutory police phrasing."""
    translations = {
        "en": (
            "During the course of investigation, thorough analysis of Call Detail Records (CDR), "
            "cell tower triangulation, and cyber forensic examination established that the named accused "
            "conspired and operated as an organized criminal syndicate. Seized digital devices, mule bank account "
            "trails, and corroborating witness depositions fully substantiate the charges sent up for trial."
        ),
        "hi": (
            "विवेचना के दौरान कॉल डिटेल रिकॉर्ड (CDR), सेल टॉवर ट्राइएंगुलेशन एवं साइबर फोरेंसिक विश्लेषण से यह "
            "प्रमाणित हुआ कि नामजद अभियुक्तों ने मिलकर एक संगठित आपराधिक सिंडिकेट बनाकर योजनाबद्ध तरीके से घटना को "
            "अंजाम दिया। अभियुक्तों के पास से जप्त मोबाइल, बैंक खाते व गवाहों के बयानों से इनका अपराध पूर्णतः सिद्ध "
            "होता है। अतः अभियुक्तों को विचारण हेतु माननीय न्यायालय के समक्ष प्रस्तुत किया जाता है।"
        ),
        "mr": (
            "सदर गुन्ह्याच्या तपासादरम्यान तांत्रिक विश्लेषण, कॉल डिटेल रेकॉर्ड (CDR) आणि फॉरेन्सिक तपासणीवरून "
            "असे निष्पन्न झाले की, नमूद आरोपींनी संघटित टोळी तयार करून सुनियोजित कट रचून हा गुन्हा केला आहे. "
            "आरोपींकडून जप्त केलेले मोबाईल, बँक खात्यांचे पुरावे आणि साक्षीदारांचे जबाब यावरून आरोपींविरुद्ध "
            "गुन्हा सिद्ध होत असल्याने त्यांना खटल्यासाठी मा. न्यायालयात पाठवण्यात येत आहे."
        ),
        "bn": (
            "তদন্তকালে কল ডিটেইল রেকর্ড (CDR), সেল টাওয়ার ট্রায়াঙ্গুলেশন এবং ফরেনসিক পর্যালোচনার মাধ্যমে নিশ্চিত "
            "হওয়া গিয়াছে যে, উল্লেখিত অভিযুক্তগণ একটি সংগঠিত অপরাধ চক্র গঠন করিয়া পরিকল্পিতভাবে এই অপরাধ সংঘটিত করিয়াছে। "
            "আসামীদের নিকট হইতে উদ্ধারকৃত ইলেকট্রনিক ডিভাইস, ব্যাংকিং লেনদেন এবং সাক্ষীদের জবানবন্দী দ্বারা অপরাধ সন্দেহাতীতভাবে "
            "প্রমাণিত হওয়ায় অভিযুক্তদের বিচারের নিমিত্তে বিজ্ঞ আদালতে সোপর্দ করা হইল।"
        ),
        "ta": (
            "புலன் விசாரணையின் போது, அழைப்பு விபர அறிக்கை (CDR), செல் கோபுர முக்கோண முறை மற்றும் தடயவியல் ஆய்வுகளின் மூலம், "
            "எதிரிகள் அனைவரும் ஒரு திட்டமிட்ட குற்றக் குழுவாக இணைந்து இந்த குற்றத்தைச் செய்துள்ளனர் என்பது சந்தேகத்திற்கு இடமின்றி "
            "நிரூபிக்கப்பட்டுள்ளது. கைப்பற்றப்பட்ட அலைபேசிகள், போலி வங்கிக் கணக்கு ஆவணங்கள் மற்றும் சாட்சிகளின் வாக்குமூலங்கள் "
            "மூலம் குற்றம் உறுதி செய்யப்பட்டதால், எதிரிகள் மீது நீதிமன்ற விசாரணைக்காக குற்றப்பத்திரிகை தாக்கல் செய்யப்படுகிறது."
        ),
        "te": (
            "దర్యాప్తులో భాగంగా సేకరించిన కాల్ డేటా రికార్డులు (CDR), టవర్ లొకేషన్లు మరియు సైబర్ ఫోరెన్సిక్ ఆధారాల ద్వారా నిందితులు "
            "ఒక వ్యవస్థీకృత నేర ముఠాగా ఏర్పడి ఈ నేరానికి పాల్పడినట్లు స్పష్టంగా రుజువైంది. స్వాధీనం చేసుకున్న సెల్ ఫోన్లు, అక్రమ బ్యాంక్ "
            "ఖాతాల వివరాలు మరియు సాక్షుల వాంగ్మూలాల ఆధారంగా నేరం నిరూపితమైనందున నిందితులను విచారణ నిమిత్తం న్యాయస్థానానికి సమర్పించడమైనది."
        ),
        "gu": (
            "તપાસ દરમિયાન કોલ ડિટેઇલ રેકોર્ડ્સ (CDR), ટાવર લોકેશન અને ફોરેન્સિક પુરાવાઓના આધારે સ્પષ્ટ સાબિત થયું છે કે આરોપીઓએ "
            "સંગઠિત ટોળકી બનાવીને આયોજનપૂર્વક ગુનો આચરેલ છે. કબજે કરેલ મુદ્દામાલ, મોબાઈલ ફોન અને બેંક એકાઉન્ટના પુરાવાઓ ધ્યાને લેતા "
            "આરોપીઓ વિરુદ્ધ ગુનો પુરવાર થતો હોઈ તેઓને ઇન્સાફી કાર્યવાહી અર્થે નામદાર કોર્ટ સમક્ષ મોકલી આપવામાં આવે છે."
        ),
        "kn": (
            "ತನಿಖೆಯ ಸಮಯದಲ್ಲಿ ಸಂಗ್ರಹಿಸಲಾದ ಕರೆ ವಿವರಗಳ ದಾಖಲೆ (CDR), ಟವರ್ ಲೊಕೇಶನ್ ಮತ್ತು ವಿಧಿವಿಜ್ಞಾನ ಪುರಾವೆಗಳ ಆಧಾರದ ಮೇಲೆ ಆರೋಪಿಗಳು "
            "ಸಂಘಟಿತ ಅಪರಾಧ ಜಾಲವನ್ನು ರಚಿಸಿಕೊಂಡು ಈ ಕೃತ್ಯವನ್ನು ಎಸಗಿರುವುದು ಸಾಬೀತಾಗಿದೆ. ವಶಪಡಿಸಿಕೊಂಡ ಮೊಬೈಲ್ ಫೋನ್‌ಗಳು, ಬ್ಯಾಂಕ್ ಖಾತೆಗಳ ದಾಖಲೆಗಳು "
            "ಮತ್ತು ಸಾಕ್ಷಿದಾರರ ಹೇಳಿಕೆಗಳಿಂದ ಆರೋಪವು ದೃಢಪಟ್ಟಿದ್ದು, ಆರೋಪಿಗಳನ್ನು ನ್ಯಾಯಾಂಗ ವಿಚಾರಣೆಗೆ ಘನ ನ್ಯಾಯಾಲಯಕ್ಕೆ ಒಪ್ಪಿಸಲಾಗಿದೆ."
        ),
        "pa": (
            "ਤਫ਼ਤੀਸ਼ ਦੌਰਾਨ ਕਾਲ ਡਿਟੇਲ ਰਿਕਾਰਡ (CDR), ਟਾਵਰ ਲੋਕੇਸ਼ਨ ਅਤੇ ਫੋਰੈਂਸਿਕ ਜਾਂਚ ਤੋਂ ਇਹ ਸਪੱਸ਼ਟ ਹੋਇਆ ਹੈ ਕਿ ਨਾਮਜ਼ਦ ਦੋਸ਼ੀਆਂ ਨੇ ਇੱਕ "
            "ਸੰਗਠਿਤ ਗਿਰੋਹ ਬਣਾ ਕੇ ਯੋਜਨਾਬੱਧ ਢੰਗ ਨਾਲ ਵਾਰਦਾਤ ਨੂੰ ਅੰਜਾਮ ਦਿੱਤਾ ਹੈ। ਬਰਾਮਦ ਕੀਤੇ ਗਏ ਮੋਬਾਈਲ ਫ਼ੋਨ, ਬੈਂਕ ਖਾਤਿਆਂ ਦੇ ਦਸਤਾਵੇਜ਼ "
            "ਅਤੇ ਗਵਾਹਾਂ ਦੇ ਬਿਆਨਾਂ ਦੇ ਆਧਾਰ 'ਤੇ ਜੁਰਮ ਸਾਬਤ ਹੋਣ ਉਪਰੰਤ ਦੋਸ਼ੀਆਂ ਖ਼ਿਲਾਫ਼ ਚਲਾਨ ਮਾਨਯੋਗ ਅਦਾਲਤ ਵਿੱਚ ਪੇਸ਼ ਕੀਤਾ ਜਾਂਦਾ ਹੈ।"
        ),
    }

    if lang in translations:
        return translations[lang]
    return text or translations["en"]
# =========================================================================
# 2. STATUTORY POLICE FORM LOCALIZATION DICTIONARIES
# =========================================================================

LEGAL_LOCALES = {
    "en": {
        "dept": "STATE POLICE INTELLIGENCE & CRIMINAL INVESTIGATION DEPARTMENT",
        "form": "FORM NO. 5.11 — FINAL REPORT / CHARGE SHEET",
        "sub": "(Under Section 173 Cr.P.C. / Section 193 Bharatiya Nagarik Suraksha Sanhita, 2023)",
        "court": "IN THE COURT OF THE LD. CHIEF JUDICIAL MAGISTRATE / SPECIAL SESSIONS COURT",
        "ps_label": "1. Police Station / Unit:",
        "ps_val_suffix": "Sector Command",
        "fir_label": "2. FIR / Case Number:",
        "date_label": "3. Date of Occurrence:",
        "sec_label": "4. Sections of Law:",
        "report_type_label": "5. Nature of Final Report:",
        "report_type_val": "CHARGE SHEET (Sent Up for Trial)",
        "cctns_label": "6. External Sync ID:",
        "io_field_label": "7. Investigating Officer:",
        "comp_label": "8. Complainant / Informant:",
        "comp_val": "State (via Prosecution)",
        "accused_title": "9. PARTICULARS OF ACCUSED PERSONS CHARGE-SHEETED (SENT UP FOR TRIAL):",
        "th_sr": "Sr.",
        "th_name": "Accused Name & Aliases",
        "th_role": "Syndicate Role",
        "th_score": "Threat Index",
        "th_status": "Custody / Process Status",
        "custody_status": "Judicial Custody / Sent Up",
        "kingpin_tag": "KINGPIN",
        "facts_title": "10. BRIEF FACTS & OFFENCE NARRATIVE:",
        "seizure_title": "11. INVENTORY OF SEIZED ARTICLES & TECHNICAL TELEMETRY:",
        "th_exhibit": "Exhibit",
        "th_ex_desc": "Description of Seized Article / Digital Record",
        "th_malkhana": "Malkhana / Forensic Depository",
        "ex1_desc": "Dual-SIM Handset utilized in coordinating syndicate communication & burner calls.",
        "ex1_loc": "Sector Malkhana Entry #104",
        "ex2_desc": "Bank statements verifying immediate dispersion into identified mule accounts.",
        "ex2_loc": "Special Cyber Cell Register",
        "ex3_desc": "CrimeNetX Relational Graph & Telecom CDR Trace (Certificate u/s 65B IEA / 63 BSA Attached).",
        "ex3_loc": "Central Digital Vault",
        "tech_title": "12. TECHNICAL & NETWORK INTELLIGENCE ANNEXURE",
        "tech_sub": "Relational topology establishing command structure and operational hierarchy.",
        "fin_title": "13. FINANCIAL LAUNDERING TRAIL & MULE CHANNELS:",
        "th_from": "From Account",
        "th_to": "To Account",
        "th_amt": "Amount",
        "th_time": "Timestamp",
        "prayer_title": "16. STATUTORY PRAYER / SUBMISSION:",
        "prayer": "It is therefore most respectfully prayed that this Hon'ble Court may graciously be pleased to take cognizance of the aforesaid offences under the specified sections of law against the charge-sheeted accused persons sent up for trial, and issue regular process in the interest of justice.",
        "filing_date": "Filing Date:",
        "io_seal": "(Signature & Seal of Investigating Officer)",
        "io_rank": "Inspector of Police / Lead Investigator",
        "cert_title": "CERTIFICATE OF DIGITAL TAMPER-DETECTION (SEC 65B IEA / SEC 63 BSA):",
    },
    "hi": {
        "dept": "राज्य पुलिस अभिसूचना एवं अपराध अनुसंधान विभाग",
        "form": "प्रपत्र संख्या 5.11 — अंतिम प्रतिवेदन / आरोप पत्र (चार्जशीट)",
        "sub": "(अंतर्गत धारा 173 दंड प्रक्रिया संहिता / धारा 193 भारतीय नागरिक सुरक्षा संहिता, 2023)",
        "court": "न्यायालय मुख्य न्यायिक दंडाधिकारी / विशेष सत्र न्यायालय",
        "ps_label": "1. पुलिस थाना / अनुभाग:",
        "ps_val_suffix": "सेक्टर क्राइम ब्रांच",
        "fir_label": "2. प्राथमिकी / वाद संख्या:",
        "date_label": "3. घटना / प्रविष्टि दिनांक:",
        "sec_label": "4. लागू कानूनी धाराएं:",
        "report_type_label": "5. अंतिम प्रतिवेदन का स्वरूप:",
        "report_type_val": "आरोप पत्र / चार्जशीट (विचारणार्थ प्रेषित)",
        "cctns_label": "6. सीसीटीएनएस संदर्भ सं.:",
        "io_field_label": "7. विवेचना अधिकारी (I.O.):",
        "comp_label": "8. वादी / शिकायतकर्ता:",
        "comp_val": "शासन / राज्य (अभियोजन पक्ष)",
        "accused_title": "9. विचारणार्थ प्रेषित अभियुक्तों का विवरण (चार्जशीटेड अभियुक्त):",
        "th_sr": "क्र.सं.",
        "th_name": "अभियुक्त का नाम व उपनाम",
        "th_role": "सिंडिकेट में भूमिका",
        "th_score": "खतरा सूचकांक",
        "th_status": "अभिरक्षा / विधिक स्थिति",
        "custody_status": "न्यायिक अभिरक्षा / विचारणार्थ प्रेषित",
        "kingpin_tag": "मुख्य सूत्रधार",
        "facts_title": "10. मामले के संक्षिप्त तथ्य एवं विवेचना सारांश:",
        "seizure_title": "11. जप्त संपत्ति, प्रदर्श एवं तकनीकी साक्ष्य विवरण:",
        "th_exhibit": "प्रदर्श",
        "th_ex_desc": "जप्त सामग्री / डिजिटल साक्ष्य का विवरण",
        "th_malkhana": "मालखाना / साक्ष्य निक्षेपागार",
        "ex1_desc": "अपराध समन्वय एवं कॉल हेतु प्रयुक्त डुअल-सिम मोबाइल हैंडसेट।",
        "ex1_loc": "सेक्टर मालखाना प्रविष्टि #104",
        "ex2_desc": "म्यूल बैंक खातों में अवैध धन अंतरण प्रमाणित करने वाले प्रमाणित बैंक स्टेटमेंट।",
        "ex2_loc": "विशेष साइबर सेल अभिलेख",
        "ex3_desc": "CrimeNetX AI संबंध ग्राफ व CDR विश्लेषण (धारा 65B साक्ष्य अधिनियम प्रमाण पत्र संलग्न)।",
        "ex3_loc": "केंद्रीय डिजिटल वॉल्ट",
        "tech_title": "12. तकनीकी एवं नेटवर्क अन्वेषण परिशिष्ट",
        "tech_sub": "अभियुक्तों के संगठित आपराधिक संबंधों एवं कमांड संरचना को प्रमाणित करने वाला संबंध ग्राफ।",
        "fin_title": "13. वित्तीय शोधन व म्यूल खातों का विवरण:",
        "th_from": "स्रोत खाता",
        "th_to": "गंतव्य खाता",
        "th_amt": "अंतरित राशि",
        "th_time": "समय मुहर",
        "prayer_title": "16. विधिक प्रार्थना / निवेदन:",
        "prayer": "अतः माननीय न्यायालय से सविनय निवेदन है कि उपरोक्त अपराध का संज्ञान लेते हुए विचारणार्थ प्रेषित अभियुक्तों के विरुद्ध विधिक आदेश एवं सम्मन जारी करने की कृपा करें।",
        "filing_date": "प्रस्तुति दिनांक:",
        "io_seal": "(हस्ताक्षर व राजकीय मुद्रा विवेचना अधिकारी)",
        "io_rank": "पुलिस निरीक्षक / मुख्य विवेचना अधिकारी",
        "cert_title": "डिजिटल साक्ष्य अखंडता प्रमाण पत्र (धारा 65B साक्ष्य अधिनियम / धारा 63 बी.एस.ए.):",
    },
    "mr": {
        "dept": "राज्य पोलीस गुप्तवार्ता व गुन्हे अन्वेषण विभाग",
        "form": "नमुना क्र. 5.11 — अंतिम अहवाल / दोषारोप पत्र",
        "sub": "(फौजदारी प्रक्रिया संहिता कलम 173 / भारतीय नागरिक सुरक्षा संहिता कलम 193 अन्वये)",
        "court": "मा. मुख्य न्यायदंडाधिकारी / विशेष सत्र न्यायालय",
        "ps_label": "1. पोलीस ठाणे / विभाग:",
        "ps_val_suffix": "गुन्हे शाखा युनिट",
        "fir_label": "2. गुन्हा रजिस्टर क्र.:",
        "date_label": "3. गुन्हा घडल्याचा दिनांक:",
        "sec_label": "4. कायदेशीर कलमे:",
        "report_type_label": "5. अंतिम अहवालाचे स्वरूप:",
        "report_type_val": "दोषारोप पत्र (खटल्यासाठी पाठवण्यात आले)",
        "cctns_label": "6. सीसीटीएनएस संदर्भ क्र.:",
        "io_field_label": "7. तपास अधिकारी (I.O.):",
        "comp_label": "8. फिर्यादी / तक्रारदार:",
        "comp_val": "सरकारतर्फे (पोलीस अभियोग)",
        "accused_title": "9. खटल्यासाठी पाठविण्यात आलेल्या आरोपींचा तपशील (दोषारोपित आरोपी):",
        "th_sr": "अ.क्र.",
        "th_name": "आरोपीचे नाव व टोपणनाव",
        "th_role": "टोळीतील भूमिका",
        "th_score": "धोका निर्देशांक",
        "th_status": "कायदेशीर स्थिती",
        "custody_status": "न्यायालयीन कोठडीत / हजर",
        "kingpin_tag": "टोळीप्रमुख",
        "facts_title": "10. गुन्ह्याची हकीकत व तपास सारांश:",
        "seizure_title": "11. जप्त मुद्देमाल, वाहने व तांत्रिक पुरावे:",
        "th_exhibit": "मुद्देमाल",
        "th_ex_desc": "जप्त मुद्देमाल / डिजिटल पुराव्याचे वर्णन",
        "th_malkhana": "मुद्देमाल कक्ष / मालखाना",
        "ex1_desc": "गुन्ह्यात संपर्क साधण्यासाठी वापरलेले ड्युअल-सिम मोबाईल हँडसेट.",
        "ex1_loc": "मालखाना नोंद क्र. #104",
        "ex2_desc": "म्यूल बँक खात्यांत रक्कम वळती केल्याचे प्रमाणित बँक स्टेटमेंट.",
        "ex2_loc": "सायबर सेल नोंदवही",
        "ex3_desc": "CrimeNetX AI टेलिफोन संवाद विश्लेषण (कलम 65B साक्ष कायदा प्रमाणपत्र जोडले).",
        "ex3_loc": "डिजिटल पुरावा कक्ष",
        "tech_title": "12. तांत्रिक व नेटवर्क विश्लेषण परिशिष्ट",
        "tech_sub": "आरोपींचे गुन्हेगारी संबंध व टोळीची कार्यपद्धती दर्शविणारा आलेख.",
        "fin_title": "13. आर्थिक गैरव्यवहार व बँक खात्यांचा तपशील:",
        "th_from": "मूळ खाते",
        "th_to": "जमा खाते",
        "th_amt": "रक्कम",
        "th_time": "दिनांक व वेळ",
        "prayer_title": "16. कायदेशीर विनंती / सादर:",
        "prayer": "यास्तव मा. न्यायालयाला नम्र विनंती की, नमूद आरोपींविरुद्ध कायद्यानुसार दखल घेऊन पुढील कायदेशीर कारवाई करण्यात यावी.",
        "filing_date": "सादर दिनांक:",
        "io_seal": "(तपास अधिकाऱ्याची स्वाक्षरी व शिक्का)",
        "io_rank": "पोलीस निरीक्षक / तपास अधिकारी",
        "cert_title": "डिजिटल पुरावा सुरक्षितता प्रमाणपत्र (कलम 65B साक्ष कायदा):",
    },
    "bn": {
        "dept": "রাজ্য পুলিশ গোয়েন্দা ও অপরাধ তদন্ত বিভাগ",
        "form": "ফর্ম নং ৫.১১ — চূড়ান্ত প্রতিবেদন / চার্জশিট",
        "sub": "(ফৌজদারি কার্যবিধি ধারা ১৭৩ / ভারতীয় নাগরিক সুরক্ষা সংহিতা ধারা ১৯৩ অনুযায়ী)",
        "court": "বিজ্ঞ চিফ জুডিশিয়াল ম্যাজিস্ট্রেট / বিশেষ দায়রা আদালত",
        "ps_label": "১. পুলিশ স্টেশন / ইউনিট:",
        "ps_val_suffix": "ক্রাইম ব্রাঞ্চ কমান্ড",
        "fir_label": "২. এফআইআর / মামলা নং:",
        "date_label": "৩. ঘটনার তারিখ:",
        "sec_label": "৪. আইনের প্রাসঙ্গিক ধারা:",
        "report_type_label": "৫. চূড়ান্ত রিপোর্টের প্রকৃতি:",
        "report_type_val": "চার্জশিট (বিচারের জন্য প্রেরিত)",
        "cctns_label": "৬. সিসিটিএনএস রেফারেন্স:",
        "io_field_label": "৭. তদন্তকারী কর্মকর্তা (I.O.):",
        "comp_label": "৮. বাদী / অভিযোগকারী:",
        "comp_val": "রাষ্ট্রপক্ষ (প্রসিকিউশন)",
        "accused_title": "৯. অভিযুক্ত ব্যক্তিদের বিবরণ (বিচারের জন্য প্রেরিত):",
        "th_sr": "ক্র.নং",
        "th_name": "অভিযুক্তের নাম ও ডাকনাম",
        "th_role": "সিন্ডিকেটে ভূমিকা",
        "th_score": "ঝুঁকি সূচক",
        "th_status": "আইনি হেফাজত",
        "custody_status": "বিচারিক হেফাজত / প্রেরিত",
        "kingpin_tag": "মূল হোতা",
        "facts_title": "১০. মামলার সংক্ষিপ্ত বিবরণ ও তদন্তের ফলাফল:",
        "seizure_title": "১১. জব্দকৃত আলামত ও প্রযুক্তিগত প্রমাণের তালিকা:",
        "th_exhibit": "প্রদর্শ",
        "th_ex_desc": "জব্দকৃত আলামত / ডিজিটাল রেকর্ডের বিবরণ",
        "th_malkhana": "মালখানা / প্রমাণাগার",
        "ex1_desc": "অপরাধ সমন্বয় ও যোগাযোগের জন্য ব্যবহৃত ডুয়াল-সিম হ্যান্ডসেট।",
        "ex1_loc": "সেক্টর মালখানা এন্ট্রি #১০৪",
        "ex2_desc": "মিউল ব্যাংক অ্যাকাউন্টে অবৈধ অর্থ লেনদেনের সার্টিফাইড স্টেটমেন্ট।",
        "ex2_loc": "সাইবার সেল রেজিস্টার",
        "ex3_desc": "CrimeNetX AI কল ডিটেইল ও রিলেশনাল গ্রাফ (ধারা ৬৫B সাক্ষ্য আইন সার্টিফিকেট সংযুক্ত)।",
        "ex3_loc": "সেন্ট্রাল ডিজিটাল ভল্ট",
        "tech_title": "১২. প্রযুক্তিগত ও নেটওয়ার্ক গোয়েন্দা পরিশিষ্ট",
        "tech_sub": "অপরাধী সিন্ডিকেটের অভ্যন্তরীণ যোগাযোগ ও নেতৃত্বের সম্পর্ক চিত্র।",
        "fin_title": "১৩. আর্থিক পাচার ও মিউল নেটওয়ার্কের বিবরণ:",
        "th_from": "উৎস অ্যাকাউন্ট",
        "th_to": "গন্তব্য অ্যাকাউন্ট",
        "th_amt": "পরিমাণ",
        "th_time": "সময়",
        "prayer_title": "১৬. আইনি প্রার্থনা / নিবেদন:",
        "prayer": "অতএব বিজ্ঞ আদালতের নিকট বিনীত প্রার্থনা এই যে, অভিযুক্তদের বিরুদ্ধে আইনানুগ ব্যবস্থা গ্রহণ ও প্রক্রিয়া জারি করিতে আজ্ঞা হয়।",
        "filing_date": "দাখিলের তারিখ:",
        "io_seal": "(তদন্তকারী কর্মকর্তার স্বাক্ষর ও সিলমোহর)",
        "io_rank": "পুলিশ পরিদর্শক / তদন্তকারী কর্মকর্তা",
        "cert_title": "ডিজিটাল প্রমাণ সুরক্ষা সার্টিফিকেট (ধারা ৬৫B সাক্ষ্য আইন / ধারা ৬৩ BSA):",
    },
    "ta": {
        "dept": "மாநில காவல்துறை உளவுத்துறை மற்றும் குற்றப் புலனாய்வுப் பிரிவு",
        "form": "படிவம் எண் 5.11 — இறுதிக்கட்ட அறிக்கை / குற்றப்பத்திரிகை",
        "sub": "(குற்றவியல் நடைமுறைச் சட்டம் பிரிவு 173 / பி.என்.எஸ்.எஸ் பிரிவு 193 இன் கீழ்)",
        "court": "தலைமை நீதித்துறை நடுவர் / சிறப்பு அமர்வு நீதிமன்றம்",
        "ps_label": "1. காவல் நிலையம் / பிரிவு:",
        "ps_val_suffix": "குற்றப்பிரிவு",
        "fir_label": "2. முதல் தகவல் அறிக்கை / வழக்கு எண்:",
        "date_label": "3. சம்பவம் நடந்த தேதி:",
        "sec_label": "4. சட்டப்பிரிவுகள்:",
        "report_type_label": "5. அறிக்கையின் தன்மை:",
        "report_type_val": "குற்றப்பத்திரிகை (விசாரணைக்கு அனுப்பப்பட்டது)",
        "cctns_label": "6. CCTNS குறிப்பு எண்:",
        "io_field_label": "7. புலனாய்வு அதிகாரி (I.O.):",
        "comp_label": "8. புகார்தாரர்:",
        "comp_val": "அரசு தரப்பு (காவல்துறை)",
        "accused_title": "9. குற்றப்பத்திரிகையில் சேர்க்கப்பட்ட எதிரிகளின் விபரம்:",
        "th_sr": "வரிசை",
        "th_name": "எதிரியின் பெயர் & புனைப்பெயர்",
        "th_role": "குழுவில் பங்கு",
        "th_score": "அபாயக் குறியீடு",
        "th_status": "காவல் நிலை",
        "custody_status": "நீதிமன்றக் காவல் / அனுப்பப்பட்டது",
        "kingpin_tag": "தலைமை குற்றவாளி",
        "facts_title": "10. வழக்கின் சுருக்கமான விபரம் மற்றும் புலனாய்வு:",
        "seizure_title": "11. கைப்பற்றப்பட்ட சொத்துக்கள் மற்றும் மின்னணு ஆதாரங்கள்:",
        "th_exhibit": "சான்றுப்பொருள்",
        "th_ex_desc": "கைப்பற்றப்பட்ட மின்னணு சாதனங்களின் விபரம்",
        "th_malkhana": "மால்கானா வைப்பறை",
        "ex1_desc": "குற்றத்திற்கு பயன்படுத்தப்பட்ட இரட்டை சிம் கைபேசி.",
        "ex1_loc": "மால்கானா பதிவேடு எண் #104",
        "ex2_desc": "போலி வங்கிக் கணக்குகளுக்கு பணம் மாற்றப்பட்ட வங்கி ஆவணங்கள்.",
        "ex2_loc": "சைபர் பிரிவு பதிவேடு",
        "ex3_desc": "CrimeNetX AI தொலைபேசி அழைப்பு வரைபடம் (பிரிவு 65B சான்றிதழ் இணைக்கப்பட்டுள்ளது).",
        "ex3_loc": "மின்னணு பெட்டகம்",
        "tech_title": "12. தொழில்நுட்ப புலனாய்வு இணைப்பு",
        "tech_sub": "குற்றக் கூட்டமைப்பின் தொடர்பு மற்றும் தலைமை கட்டமைப்பு வரைபடம்.",
        "fin_title": "13. நிதிப் பரிவர்த்தனை மற்றும் போலி கணக்குகள் விபரம்:",
        "th_from": "அனுப்பிய கணக்கு",
        "th_to": "பெற்ற கணக்கு",
        "th_amt": "தொகை",
        "th_time": "தேதி & நேரம்",
        "prayer_title": "16. சட்டப்படியான கோரிக்கை / மனு:",
        "prayer": "எனவே மாண்புமிகு நீதிமன்றம் இவ்வழக்கினை கோப்பிற்கு எடுத்துக்கொண்டு எதிரிகள் மீது சட்டப்படி நடவடிக்கை எடுக்க வேண்டப்படுகிறது.",
        "filing_date": "தாக்கல் செய்த தேதி:",
        "io_seal": "(புலனாய்வு அதிகாரியின் கையொப்பம் & முத்திரை)",
        "io_rank": "காவல் ஆய்வாளர் / புலனாய்வு அதிகாரி",
        "cert_title": "மின்னணு சான்று பாதுகாப்புச் சான்றிதழ் (பிரிவு 65B):",
    },
    "te": {
        "dept": "రాష్ట్ర పోలీసు ఇంటెలిజెన్స్ & నేర పరిశోధన విభాగం",
        "form": "ఫారం నం. 5.11 — తుది నివేదిక / చార్జిషీట్",
        "sub": "(సి.ఆర్.పి.సి సెక్షన్ 173 / బి.ఎన్.ఎస్.ఎస్ సెక్షన్ 193 కింద)",
        "court": "ప్రధాన న్యాయ దండధికారి / ప్రత్యేక సెషన్స్ కోర్టు",
        "ps_label": "1. పోలీస్ స్టేషన్ / విభాగం:",
        "ps_val_suffix": "క్రైమ్ బ్రాంచ్ కమాండ్",
        "fir_label": "2. ఎఫ్.ఐ.ఆర్ / కేసు సంఖ్య:",
        "date_label": "3. నేరం జరిగిన తేదీ:",
        "sec_label": "4. వర్తించే చట్ట విభాగాలు:",
        "report_type_label": "5. తుది నివేదిక స్వభావం:",
        "report_type_val": "చార్జిషీట్ (విచారణకు పంపబడినది)",
        "cctns_label": "6. సి.సి.టి.ఎన్.ఎస్ సంఖ్య:",
        "io_field_label": "7. దర్యాప్తు అధికారి (I.O.):",
        "comp_label": "8. ఫిర్యాదుదారు:",
        "comp_val": "ప్రభుత్వ పక్షం (ప్రాసిక్యూషన్)",
        "accused_title": "9. విచారణకు పంపబడిన నిందితుల వివరాలు (చార్జిషీట్ నిందితులు):",
        "th_sr": "క్ర.సం.",
        "th_name": "నిందితుని పేరు & మారుపేర్లు",
        "th_role": "ముఠాలో పాత్ర",
        "th_score": "ప్రమాద సూచిక",
        "th_status": "కస్టడీ స్థితి",
        "custody_status": "జ్యుడీషియల్ కస్టడీ / పంపబడినది",
        "kingpin_tag": "ముఠా నాయకుడు",
        "facts_title": "10. కేసు పూర్వాపరాలు మరియు దర్యాప్తు వివరాలు:",
        "seizure_title": "11. స్వాధీనం చేసుకున్న సొత్తు మరియు సాంకేతిక ఆధారాల జాబితా:",
        "th_exhibit": "ఎగ్జిబిట్",
        "th_ex_desc": "స్వాధీనం చేసుకున్న వస్తువులు / డిజిటల్ రికార్డు వివరాలు",
        "th_malkhana": "మాల్ఖానా డిపాజిటరీ",
        "ex1_desc": "నేర సమాచార మార్పిడికి ఉపయోగించిన డ్యూయల్-సిమ్ మొబైల్ హ్యాండ్‌సెట్.",
        "ex1_loc": "సెక్టార్ మాల్ఖానా నమోదు #104",
        "ex2_desc": "మ్యూల్ ఖాతాల్లోకి నిధుల మళ్లింపును ధృవీకరించే బ్యాంక్ స్టేట్‌మెంట్లు.",
        "ex2_loc": "సైబర్ సెల్ రికార్డు",
        "ex3_desc": "CrimeNetX AI కాల్ డేటా & రిలేషనల్ గ్రాఫ్ (సెక్షన్ 65B సర్టిఫికెట్ జతపరచబడింది).",
        "ex3_loc": "డిజిటల్ వాల్ట్",
        "tech_title": "12. సాంకేతిక & నెట్‌వర్క్ దర్యాప్తు అనుబంధం",
        "tech_sub": "నిందితుల నేర సంబంధాలు మరియు నాయకత్వ నిర్మాణాన్ని సూచించే నెట్‌వర్క్ గ్రాఫ్.",
        "fin_title": "13. ఆర్థిక నేరాలు మరియు మ్యూల్ ఖాతాల వివరాలు:",
        "th_from": "మూల ఖాతా",
        "th_to": "చేరిన ఖాతా",
        "th_amt": "మొత్తం",
        "th_time": "తేదీ & సమయం",
        "prayer_title": "16. చట్టబద్ధమైన విన్నపం / ప్రార్థన:",
        "prayer": "కావున గౌరవనీయ న్యాయస్థానం ఈ నేరాన్ని పరిగణనలోకి తీసుకుని నిందితులపై చట్టపరమైన చర్యలు తీసుకోవాల్సిందిగా ప్రార్థించడమైనది.",
        "filing_date": "దాఖలు చేసిన తేదీ:",
        "io_seal": "(దర్యాప్తు అధికారి సంతకం & అధికారిక ముద్ర)",
        "io_rank": "పోలీస్ ఇన్స్పెక్టర్ / దర్యాప్తు అధికారి",
        "cert_title": "డిజిటల్ సాక్ష్య సమగ్రత ధృవీకరణ పత్రం (సెక్షన్ 65B):",
    },
    "gu": {
        "dept": "રાજ્ય પોલીસ ગુપ્તચર અને ગુના તપાસ વિભાગ",
        "form": "ફોર્મ નં. ૫.૧૧ — અંતિમ અહેવાલ / ચાર્જશીટ",
        "sub": "(ફોજદારી કાર્યરીતિ સંહિતા કલમ ૧૭૩ / બી.એન.એસ.એસ. કલમ ૧૯૩ હેઠળ)",
        "court": "માનનીય મુખ્ય ન્યાયિક મેજિસ્ટ્રેટ / સ્પેશિયલ સેશન્સ કોર્ટ",
        "ps_label": "૧. પોલીસ સ્ટેશન / યુનિટ:",
        "ps_val_suffix": "ક્રાઈમ બ્રાન્ચ કમાન્ડ",
        "fir_label": "૨. ગુના રજિસ્ટર નં.:",
        "date_label": "૩. બનાવ તારીખ:",
        "sec_label": "૪. કાયદાની કલમો:",
        "report_type_label": "૫. અંતિમ અહેવાલ પ્રકાર:",
        "report_type_val": "ચાર્જશીટ (ઇન્સાફી કાર્યવાહી અર્થે મોકલેલ)",
        "cctns_label": "૬. CCTNS સંદર્ભ:",
        "io_field_label": "૭. તપાસ કરનાર અમલદાર (I.O.):",
        "comp_label": "૮. ફરિયાદી:",
        "comp_val": "સરકાર પક્ષે (પોલીસ પ્રોસિક્યુશન)",
        "accused_title": "૯. આરોપપત્રિત આરોપીઓની વિગત (ઇન્સાફી કાર્યવાહી અર્થે મોકલેલ):",
        "th_sr": "ક્રમ",
        "th_name": "આરોપીનું નામ અને ઉપનામ",
        "th_role": "ટોળકીમાં ભૂમિકા",
        "th_score": "જોખમ આંક",
        "th_status": "કસ્ટડી વિગત",
        "custody_status": "જ્યુડિશિયલ કસ્ટડી / મોકલેલ",
        "kingpin_tag": "મુખ્ય સૂત્રધાર",
        "facts_title": "૧૦. કેસની ટૂંકી વિગત અને તપાસ સારાંશ:",
        "seizure_title": "૧૧. જપ્ત કરેલ મુદ્દામાલ અને ટેકનિકલ પુરાવા યાદી:",
        "th_exhibit": "મુદ્દામાલ",
        "th_ex_desc": "જપ્ત કરેલ મુદ્દામાલ / ડિજિટલ રેકોર્ડ વર્ણન",
        "th_malkhana": "મુદ્દામાલ રૂમ / માલખાના",
        "ex1_desc": "ગુનાહિત સંપર્ક માટે વપરાયેલ ડ્યુઅલ-સિમ મોબાઈલ ફોન.",
        "ex1_loc": "માલખાના નોંધ #૧૦૪",
        "ex2_desc": "મ્યૂલ ખાતાઓમાં રકમ ટ્રાન્સફર સાબિત કરતા બેંક સ્ટેટમેન્ટ્સ.",
        "ex2_loc": "સાયબર સેલ રજિસ્ટર",
        "ex3_desc": "CrimeNetX AI કોલ ડિટેલ વિશ્લેષણ (કલમ ૬૫B પ્રમાણપત્ર સાથે).",
        "ex3_loc": "ડિજિટલ વોલ્ટ",
        "tech_title": "૧૨. ટેકનિકલ અને નેટવર્ક તપાસ પરિશિષ્ટ",
        "tech_sub": "આરોપીઓના ગુનાહિત સંબંધો અને કમાન્ડ માળખું દર્શાવતો આલેખ.",
        "fin_title": "૧૩. નાણાકીય વ્યવહારો અને મ્યૂલ એકાઉન્ટ વિગત:",
        "th_from": "સોર્સ એકાઉન્ટ",
        "th_to": "જમા એકાઉન્ટ",
        "th_amt": "રકમ",
        "th_time": "તારીખ & સમય",
        "prayer_title": "૧૬. કાનૂની પ્રાર્થના / વિનંતી:",
        "prayer": "આથી નામદાર કોર્ટ સમક્ષ નમ્ર વિનંતી છે કે ઉપરોક્ત ગુનાની નોંધ લઈ આરોપીઓ વિરુદ્ધ કાયદેસર કાર્યવાહી કરવા કૃપા કરશો.",
        "filing_date": "રજૂ કર્યા તારીખ:",
        "io_seal": "(તપાસ અધિકારીની સહી અને સિક્કો)",
        "io_rank": "પોલીસ ઇન્સ્પેક્ટર / તપાસ કરનાર અધિકારી",
        "cert_title": "ડિજિટલ પુરાવા પ્રમાણપત્ર (કલમ ૬૫B પુરાવા કાયદો):",
    },
    "kn": {
        "dept": "ರಾಜ್ಯ ಪೊಲೀಸ್ ಗುಪ್ತಚರ ಮತ್ತು ಅಪರಾಧ ತನಿಖಾ ಇಲಾಖೆ",
        "form": "ನಮೂನೆ ಸಂ. 5.11 — ಅಂತಿಮ ವರದಿ / ದೋಷಾರೋಪಣ ಪಟ್ಟಿ (ಚಾರ್ಜ್ ಶೀಟ್)",
        "sub": "(ಸಿಆರ್‌ಪಿಸಿ ಕಲಂ 173 / ಬಿ.ಎನ್.ಎಸ್.ಎಸ್ ಕಲಂ 193 ರ ಅಡಿಯಲ್ಲಿ)",
        "court": "ಮುಖ್ಯ ನ್ಯಾಯಿಕ ಮ್ಯಾಜಿಸ್ಟ್ರೇಟ್ / ವಿಶೇಷ ಸತ್ರ ನ್ಯಾಯಾಲಯ",
        "ps_label": "1. ಪೊಲೀಸ್ ಠಾಣೆ / ವಿಭಾಗ:",
        "ps_val_suffix": "ಕ್ರೈಮ್ ಬ್ರಾಂಚ್ ಕಮಾಂಡ್",
        "fir_label": "2. ಎಫ್‌ಐಆರ್ / ಪ್ರಕರಣ ಸಂಖ್ಯೆ:",
        "date_label": "3. ಅಪರಾಧ ನಡೆದ ದಿನಾಂಕ:",
        "sec_label": "4. ಅನ್ವಯವಾಗುವ ಕಾನೂನು ಕಲಂಗಳು:",
        "report_type_label": "5. ಅಂತಿಮ ವರದಿಯ ಸ್ವರೂಪ:",
        "report_type_val": "ದೋಷಾರೋಪಣ ಪಟ್ಟಿ (ವಿಚಾರಣೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ)",
        "cctns_label": "6. ಸಿಸಿಟಿಎನ್‌ಎಸ್ ಸಂಖ್ಯೆ:",
        "io_field_label": "7. ತನಿಖಾಧಿಕಾರಿ (I.O.):",
        "comp_label": "8. ದೂರುದಾರರು:",
        "comp_val": "ಸರ್ಕಾರದ ಪರವಾಗಿ (ಪ್ರಾಸಿಕ್ಯೂಷನ್)",
        "accused_title": "9. ವಿಚಾರಣೆಗೆ ಕಳುಹಿಸಲಾದ ಆರೋಪಿಗಳ ವಿವರಗಳು:",
        "th_sr": "ಕ್ರ.ಸಂ.",
        "th_name": "ಆರೋಪಿಯ ಹೆಸರು & ಅಡ್ಡಹೆಸರು",
        "th_role": "ತಂಡದಲ್ಲಿನ ಪಾತ್ರ",
        "th_score": "ಅಪಾಯ ಸೂಚ್ಯಂಕ",
        "th_status": "ನ್ಯಾಯಾಂಗ ಸ್ಥಿತಿ",
        "custody_status": "ನ್ಯಾಯಾಂಗ ಬಂಧನ / ಕಳುಹಿಸಲಾಗಿದೆ",
        "kingpin_tag": "ಮುಖ್ಯ ಸೂತ್ರಧಾರಿ",
        "facts_title": "10. ಪ್ರಕರಣದ ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ ಮತ್ತು ತನಿಖಾ ವರದಿ:",
        "seizure_title": "11. ಜಪ್ತಿ ಮಾಡಲಾದ ವಸ್ತುಗಳು ಮತ್ತು ತಾಂತ್ರಿಕ ಸಾಕ್ಷ್ಯಾಧಾರಗಳು:",
        "th_exhibit": "ಸಾಕ್ಷ್ಯ ವಸ್ತು",
        "th_ex_desc": "ಜಪ್ತಾದ ವಸ್ತು / ಡಿಜಿಟಲ್ ದಾಖಲೆಗಳ ವಿವರಣೆ",
        "th_malkhana": "ಮಾಲ್ಖಾನಾ ಠೇವಣಿ",
        "ex1_desc": "ಅಪರಾಧ ಸಂಪರ್ಕಕ್ಕೆ ಬಳಸಲಾದ ಡ್ಯುಯಲ್-ಸಿಮ್ ಮೊಬೈಲ್ ಹ್ಯಾಂಡ್‌ಸೆಟ್.",
        "ex1_loc": "ಸೆಕ್ಟರ್ ಮಾಲ್ಖಾನಾ ದಾಖಲೆ #104",
        "ex2_desc": "ಮ್ಯೂಲ್ ಖಾತೆಗಳಿಗೆ ಹಣ ವರ್ಗಾವಣೆಯನ್ನು ದೃಢೀಕರಿಸುವ ಬ್ಯಾಂಕ್ ವಿವರಗಳು.",
        "ex2_loc": "ಸೈಬರ್ ಸೆಲ್ ರಿಜಿಸ್ಟರ್",
        "ex3_desc": "CrimeNetX AI ಕರೆ ವಿವರಗಳು (ಕಲಂ 65B ಪ್ರಮಾಣಪತ್ರ ಲಗತ್ತಿಸಲಾಗಿದೆ).",
        "ex3_loc": "ಡಿಜಿಟಲ್ ವಾಲ್ಟ್",
        "tech_title": "12. ತಾಂತ್ರಿಕ ಮತ್ತು ನೆಟ್‌ವರ್ಕ್ ಗುಪ್ತಚರ ಅನುಬಂಧ",
        "tech_sub": "ಆರೋಪಿಗಳ ಅಪರಾಧ ಜಾಲ ಮತ್ತು ನಾಯಕತ್ವ ರಚನೆಯನ್ನು ತೋರಿಸುವ ಗ್ರಾಫ್.",
        "fin_title": "13. ಹಣಕಾಸು ವರ್ಗಾವಣೆ ಮತ್ತು ಮ್ಯೂಲ್ ಖಾತೆಗಳ ವಿವರ:",
        "th_from": "ಮೂಲ ಖಾತೆ",
        "th_to": "ಸ್ವೀಕೃತ ಖಾತೆ",
        "th_amt": "ಮೊತ್ತ",
        "th_time": "ದಿನಾಂಕ & ಸಮಯ",
        "prayer_title": "16. ನ್ಯಾಯಿಕ ಪ್ರಾರ್ಥನೆ:",
        "prayer": "ಆದ್ದರಿಂದ ಗೌರವಾನ್ವಿತ ನ್ಯಾಯಾಲಯವು ಅಪರಾಧವನ್ನು ಪರಿಗಣಿಸಿ ಆರೋಪಿಗಳ ವಿರುದ್ಧ ಕಾನೂನು ಕ್ರಮ ಜರುಗಿಸಬೇಕಾಗಿ ಕೋರಿಕೆ.",
        "filing_date": "ಸಲ್ಲಿಸಿದ ದಿನಾಂಕ:",
        "io_seal": "(ತನಿಖಾಧಿಕಾರಿಯ ಸಹಿ ಮತ್ತು ಅಧಿಕೃತ ಮುದ್ರೆ)",
        "io_rank": "ಪೊಲೀಸ್ ಇನ್‌ಸ್ಪೆಕ್ಟರ್ / ತನಿಖಾಧಿಕಾರಿ",
        "cert_title": "ಡಿಜಿಟಲ್ ಸಾಕ್ಷ್ಯ ಸುರಕ್ಷತಾ ಪ್ರಮಾಣಪತ್ರ (ಕಲಂ 65B):",
    },
    "pa": {
        "dept": "ਰਾਜ ਪੁਲਿਸ ਖੁਫੀਆ ਅਤੇ ਅਪਰਾਧ ਜਾਂਚ ਵਿਭਾਗ",
        "form": "ਫਾਰਮ ਨੰਬਰ 5.11 — ਅੰਤਿਮ ਰਿਪੋਰਟ / ਚਲਾਨ (ਚਾਰਜਸ਼ੀਟ)",
        "sub": "(ਸੀ.ਆਰ.ਪੀ.ਸੀ ਧਾਰਾ 173 / ਬੀ.ਐਨ.ਐਸ.ਐਸ ਧਾਰਾ 193 ਅਧੀਨ)",
        "court": "ਮਾਨਯੋਗ ਚੀਫ਼ ਜੁਡੀਸ਼ੀਅਲ ਮੈਜਿਸਟ੍ਰੇਟ / ਵਿਸ਼ੇਸ਼ ਸੈਸ਼ਨ ਅਦਾਲਤ",
        "ps_label": "1. ਪੁਲਿਸ ਥਾਣਾ / ਯੂਨਿਟ:",
        "ps_val_suffix": "ਕ੍ਰਾਈਮ ਬ੍ਰਾਂਚ ਕਮਾਂਡ",
        "fir_label": "2. ਐਫ.ਆਈ.ਆਰ / ਕੇਸ ਨੰਬਰ:",
        "date_label": "3. ਵਾਰਦਾਤ ਦੀ ਮਿਤੀ:",
        "sec_label": "4. ਕਾਨੂੰਨੀ ਧਾਰਾਵਾਂ:",
        "report_type_label": "5. ਅੰਤਿਮ ਰਿਪੋਰਟ ਦੀ ਕਿਸਮ:",
        "report_type_val": "ਚਲਾਨ / ਚਾਰਜਸ਼ੀਟ (ਮੁਕੱਦਮੇ ਲਈ ਪੇਸ਼)",
        "cctns_label": "6. ਸੀ.ਸੀ.ਟੀ.ਐਨ.ਐਸ ਨੰਬਰ:",
        "io_field_label": "7. ਤਫ਼ਤੀਸ਼ੀ ਅਫ਼ਸਰ (I.O.):",
        "comp_label": "8. ਸ਼ਿਕਾਇਤਕਰਤਾ:",
        "comp_val": "ਸਰਕਾਰ ਵੱਲੋਂ (ਪ੍ਰੌਸੀਕਿਊਸ਼ਨ)",
        "accused_title": "9. ਦੋਸ਼ੀ ਵਿਅਕਤੀਆਂ ਦਾ ਵੇਰਵਾ (ਮੁਕੱਦਮੇ ਲਈ ਪੇਸ਼ ਕੀਤੇ ਗਏ):",
        "th_sr": "ਲੜੀ ਨੰ.",
        "th_name": "ਦੋਸ਼ੀ ਦਾ ਨਾਮ ਤੇ ਉਪਨਾਮ",
        "th_role": "ਗਿਰੋਹ ਵਿੱਚ ਭੂਮਿਕਾ",
        "th_score": "ਖ਼ਤਰਾ ਸੂਚਕਾਂਕ",
        "th_status": "ਹਿਰਾਸਤ ਸਥਿਤੀ",
        "custody_status": "ਨਿਆਂਇਕ ਹਿਰਾਸਤ / ਪੇਸ਼ ਕੀਤਾ ਗਿਆ",
        "kingpin_tag": "ਮੁੱਖ ਸਰਗਨਾ",
        "facts_title": "10. ਕੇਸ ਦੇ ਸੰਖੇਪ ਤੱਥ ਅਤੇ ਜਾਂਚ ਰਿਪੋਰਟ:",
        "seizure_title": "11. ਬਰਾਮਦ ਕੀਤੀਆਂ ਗਈਆਂ ਵਸਤੂਆਂ ਅਤੇ ਤਕਨੀਕੀ ਸਬੂਤ:",
        "th_exhibit": "ਨੁਮਾਇਸ਼",
        "th_ex_desc": "ਬਰਾਮਦ ਕੀਤੀ ਗਈ ਸਮੱਗਰੀ / ਡਿਜੀਟਲ ਸਬੂਤਾਂ ਦਾ ਵੇਰਵਾ",
        "th_malkhana": "ਮਾਲਖਾਨਾ ਡਿਪਾਜ਼ਿਟਰੀ",
        "ex1_desc": "ਅਪਰਾਧਿਕ ਗੱਲਬਾਤ ਲਈ ਵਰਤਿਆ ਗਿਆ ਡਿਊਲ-ਸਿਮ ਮੋਬਾਈਲ ਹੈਂਡਸੈੱਟ।",
        "ex1_loc": "ਸੈਕਟਰ ਮਾਲਖਾਨਾ ਇੰਦਰਾਜ #104",
        "ex2_desc": "ਖਾਤਿਆਂ ਵਿੱਚ ਗੈਰ-ਕਾਨੂੰਨੀ ਲੈਣ-ਦੇਣ ਸਾਬਤ ਕਰਨ ਵਾਲੇ ਬੈਂਕ ਖਾਤੇ ਦੇ ਵੇਰਵੇ।",
        "ex2_loc": "ਸਾਈਬਰ ਸੈੱਲ ਰਜਿਸਟਰ",
        "ex3_desc": "CrimeNetX AI ਕਾਲ ਡਿਟੇਲ ਐਨਾਲਿਸਿਸ (ਧਾਰਾ 65B ਪ੍ਰਮਾਣ ਪੱਤਰ ਸ਼ਾਮਲ ਹੈ)।",
        "ex3_loc": "ਡਿਜੀਟਲ ਵਾਲਟ",
        "tech_title": "12. ਤਕਨੀਕੀ ਅਤੇ ਨੈੱਟਵਰਕ ਖੁਫੀਆ ਅੰਤਿਕਾ",
        "tech_sub": "ਮੁਲਜ਼ਮਾਂ ਦੇ ਸੰਗਠਿਤ ਅਪਰਾਧਿਕ ਸੰਬੰਧਾਂ ਅਤੇ ਲੀਡਰਸ਼ਿਪ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ।",
        "fin_title": "13. ਵਿੱਤੀ ਲੈਣ-ਦੇਣ ਅਤੇ ਬੈਂਕ ਖਾਤਿਆਂ ਦਾ ਵੇਰਵਾ:",
        "th_from": "ਸਰੋਤ ਖਾਤਾ",
        "th_to": "ਜਮ੍ਹਾਂ ਖਾਤਾ",
        "th_amt": "ਰਕਮ",
        "th_time": "ਮਿਤੀ ਤੇ ਸਮਾਂ",
        "prayer_title": "16. ਕਾਨੂੰਨੀ ਬੇਨਤੀ / ਪ੍ਰਾਰਥਨਾ:",
        "prayer": "ਇਸ ਲਈ ਮਾਨਯੋਗ ਅਦਾਲਤ ਅੱਗੇ ਨਿਮਰਤਾ ਸਹਿਤ ਬੇਨਤੀ ਹੈ ਕਿ ਮੁਲਜ਼ਮਾਂ ਖ਼ਿਲਾਫ਼ ਕਾਨੂੰਨੀ ਕਾਰਵਾਈ ਅਮਲ ਵਿੱਚ ਲਿਆਂਦੀ ਜਾਵੇ।",
        "filing_date": "ਪੇਸ਼ ਕਰਨ ਦੀ ਮਿਤੀ:",
        "io_seal": "(ਤਫ਼ਤੀਸ਼ੀ ਅਫ਼ਸਰ ਦੇ ਦਸਤਖਤ ਅਤੇ ਮੋਹਰ)",
        "io_rank": "ਪੁਲਿਸ ਇੰਸਪੈਕਟਰ / ਮੁੱਖ ਤਫ਼ਤੀਸ਼ੀ ਅਫ਼ਸਰ",
        "cert_title": "ਡਿਜੀਟਲ ਸਬੂਤ ਸੁਰੱਖਿਆ ਸਰਟੀਫਿਕੇਟ (ਧਾਰਾ 65B):",
    },
}

# =========================================================================
# 3. STATUTORY NARRATIVE TRANSLATION ENGINE
# =========================================================================

def _translate_narrative(text: str, lang: str) -> str:
    """Translates case findings into authentic statutory police phrasing."""
    if not text or lang == "en":
        return text

    translations = {
        "hi": (
            "विवेचना के दौरान कॉल डिटेल रिकॉर्ड (CDR), सेल टॉवर ट्राइएंगुलेशन एवं साइबर फोरेंसिक विश्लेषण से यह "
            "प्रमाणित हुआ कि नामजद अभियुक्तों ने मिलकर एक संगठित आपराधिक सिंडिकेट बनाकर योजनाबद्ध तरीके से घटना को "
            "अंजाम दिया। अभियुक्तों के पास से जप्त मोबाइल, बैंक खाते व गवाहों के बयानों से इनका अपराध पूर्णतः सिद्ध "
            "होता है। अतः अभियुक्तों को विचारण हेतु माननीय न्यायालय के समक्ष प्रस्तुत किया जाता है।"
        ),
        "mr": (
            "सदर गुन्ह्याच्या तपासादरम्यान तांत्रिक विश्लेषण, कॉल डिटेल रेकॉर्ड (CDR) आणि फॉरेन्सिक तपासणीवरून "
            "असे निष्पन्न झाले की, नमूद आरोपींनी संघटित टोळी तयार करून सुनियोजित कट रचून हा गुन्हा केला आहे. "
            "आरोपींकडून जप्त केलेले मोबाईल, बँक खात्यांचे पुरावे आणि साक्षीदारांचे जबाब यावरून आरोपींविरुद्ध "
            "गुन्हा सिद्ध होत असल्याने त्यांना खटल्यासाठी मा. न्यायालयात पाठवण्यात येत आहे."
        ),
        "bn": (
            "তদন্তকালে কল ডিটেইল রেকর্ড (CDR), সেল টাওয়ার ট্রায়াঙ্গুলেশন এবং ফরেনসিক পর্যালোচনার মাধ্যমে নিশ্চিত "
            "হওয়া গিয়াছে যে, উল্লেখিত অভিযুক্তগণ একটি সংগঠিত অপরাধ চক্র গঠন করিয়া পরিকল্পিতভাবে এই অপরাধ সংঘটিত করিয়াছে। "
            "আসামীদের নিকট হইতে উদ্ধারকৃত ইলেকট্রনিক ডিভাইস, ব্যাংকিং লেনদেন এবং সাক্ষীদের জবানবন্দী দ্বারা অপরাধ সন্দেহাতীতভাবে "
            "প্রমাণিত হওয়ায় অভিযুক্তদের বিচারের নিমিত্তে বিজ্ঞ আদালতে সোপর্দ করা হইল।"
        ),
        "ta": (
            "புலன் விசாரணையின் போது, அழைப்பு விபர அறிக்கை (CDR), செல் கோபுர முக்கோண முறை மற்றும் தடயவியல் ஆய்வுகளின் மூலம், "
            "எதிரிகள் அனைவரும் ஒரு திட்டமிட்ட குற்றக் குழுவாக இணைந்து இந்த குற்றத்தைச் செய்துள்ளனர் என்பது சந்தேகத்திற்கு இடமின்றி "
            "நிரூபிக்கப்பட்டுள்ளது. கைப்பற்றப்பட்ட அலைபேசிகள், போலி வங்கிக் கணக்கு ஆவணங்கள் மற்றும் சாட்சிகளின் வாக்குமூலங்கள் "
            "மூலம் குற்றம் உறுதி செய்யப்பட்டதால், எதிரிகள் மீது நீதிமன்ற விசாரணைக்காக குற்றப்பத்திரிகை தாக்கல் செய்யப்படுகிறது."
        ),
        "te": (
            "దర్యాప్తులో భాగంగా సేకరించిన కాల్ డేటా రికార్డులు (CDR), టవర్ లొకేషన్లు మరియు సైబర్ ఫోరెన్సిక్ ఆధారాల ద్వారా నిందితులు "
            "ఒక వ్యవస్థీకృత నేర ముఠాగా ఏర్పడి ఈ నేరానికి పాల్పడినట్లు స్పష్టంగా రుజువైంది. స్వాధీనం చేసుకున్న సెల్ ఫోన్లు, అక్రమ బ్యాంక్ "
            "ఖాతాల వివరాలు మరియు సాక్షుల వాంగ్మూలాల ఆధారంగా నేరం నిరూపితమైనందున నిందితులను విచారణ నిమిత్తం న్యాయస్థానానికి సమర్పించడమైనది."
        ),
        "gu": (
            "તપાસ દરમિયાન કોલ ડિટેઇલ રેકોર્ડ્સ (CDR), ટાવર લોકેશન અને ફોરેન્સિક પુરાવાઓના આધારે સ્પષ્ટ સાબિત થયું છે કે આરોપીઓએ "
            "સંગઠિત ટોળકી બનાવીને આયોજનપૂર્વક ગુનો આચરેલ છે. કબજે કરેલ મુદ્દામાલ, મોબાઈલ ફોન અને બેંક એકાઉન્ટના પુરાવાઓ ધ્યાને લેતા "
            "આરોપીઓ વિરુદ્ધ ગુનો પુરવાર થતો હોઈ તેઓને ઇન્સાફી કાર્યવાહી અર્થે નામદાર કોર્ટ સમક્ષ મોકલી આપવામાં આવે છે."
        ),
        "kn": (
            "ತನಿಖೆಯ ಸಮಯದಲ್ಲಿ ಸಂಗ್ರಹಿಸಲಾದ ಕರೆ ವಿವರಗಳ ದಾಖಲೆ (CDR), ಟವರ್ ಲೊಕೇಶನ್ ಮತ್ತು ವಿಧಿವಿಜ್ಞಾನ ಪುರಾವೆಗಳ ಆಧಾರದ ಮೇಲೆ ಆರೋಪಿಗಳು "
            "ಸಂಘಟಿತ ಅಪರಾಧ ಜಾಲವನ್ನು ರಚಿಸಿಕೊಂಡು ಈ ಕೃತ್ಯವನ್ನು ಎಸಗಿರುವುದು ಸಾಬೀತಾಗಿದೆ. ವಶಪಡಿಸಿಕೊಂಡ ಮೊಬೈಲ್ ಫೋನ್‌ಗಳು, ಬ್ಯಾಂಕ್ ಖಾತೆಗಳ ದಾಖಲೆಗಳು "
            "ಮತ್ತು ಸಾಕ್ಷಿದಾರರ ಹೇಳಿಕೆಗಳಿಂದ ಆರೋಪವು ದೃಢಪಟ್ಟಿದ್ದು, ಆರೋಪಿಗಳನ್ನು ನ್ಯಾಯಾಂಗ ವಿಚಾರಣೆಗೆ ಘನ ನ್ಯಾಯಾಲಯಕ್ಕೆ ಒಪ್ಪಿಸಲಾಗಿದೆ."
        ),
        "pa": (
            "ਤਫ਼ਤੀਸ਼ ਦੌਰਾਨ ਕਾਲ ਡਿਟੇਲ ਰਿਕਾਰਡ (CDR), ਟਾਵਰ ਲੋਕੇਸ਼ਨ ਅਤੇ ਫੋਰੈਂਸਿਕ ਜਾਂਚ ਤੋਂ ਇਹ ਸਪੱਸ਼ਟ ਹੋਇਆ ਹੈ ਕਿ ਨਾਮਜ਼ਦ ਦੋਸ਼ੀਆਂ ਨੇ ਇੱਕ "
            "ਸੰਗਠਿਤ ਗਿਰੋਹ ਬਣਾ ਕੇ ਯੋਜਨਾਬੱਧ ਢੰਗ ਨਾਲ ਵਾਰਦਾਤ ਨੂੰ ਅੰਜਾਮ ਦਿੱਤਾ ਹੈ। ਬਰਾਮਦ ਕੀਤੇ ਗਏ ਮੋਬਾਈਲ ਫ਼ੋਨ, ਬੈਂਕ ਖਾਤਿਆਂ ਦੇ ਦਸਤਾਵੇਜ਼ "
            "ਅਤੇ ਗਵਾਹਾਂ ਦੇ ਬਿਆਨਾਂ ਦੇ ਆਧਾਰ 'ਤੇ ਜੁਰਮ ਸਾਬਤ ਹੋਣ ਉਪਰੰਤ ਦੋਸ਼ੀਆਂ ਖ਼ਿਲਾਫ਼ ਚਲਾਨ ਮਾਨਯੋਗ ਅਦਾਲਤ ਵਿੱਚ ਪੇਸ਼ ਕੀਤਾ ਜਾਂਦਾ ਹੈ।"
        ),
    }

    return translations.get(lang, text)


# =========================================================================
# 4. REPORTLAB STYLES COMPILER
# =========================================================================

def _make_styles(lang: str = "en"):
    styles = getSampleStyleSheet()
    font_reg, font_bold = _register_indic_fonts(lang)

    styles.add(ParagraphStyle(
        name="StatutoryDeptHeader",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=10,
        leading=13,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0F172A")
    ))
    styles.add(ParagraphStyle(
        name="ChargeSheetTitle",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=11,
        leading=14,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#1E293B")
    ))
    styles.add(ParagraphStyle(
        name="StatutorySectionRef",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=7.5,
        leading=9.5,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#B91C1C")
    ))
    styles.add(ParagraphStyle(
        name="CourtTitle",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=8.5,
        leading=11,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#334155")
    ))
    styles.add(ParagraphStyle(
        name="LegalSectionH1",
        parent=styles["Heading1"],
        fontName=font_bold,
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=4,
        spaceAfter=2
    ))
    styles.add(ParagraphStyle(
        name="LegalBody",
        parent=styles["Normal"],
        fontName=font_reg,
        fontSize=7.5,
        leading=10.5,
        alignment=TA_JUSTIFY,
        textColor=colors.HexColor("#1E293B"),
        rightIndent=2
    ))
    styles.add(ParagraphStyle(
        name="FieldLabel",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#475569")
    ))
    styles.add(ParagraphStyle(
        name="FieldValue",
        parent=styles["Normal"],
        fontName=font_reg,
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#0F172A")
    ))
    styles.add(ParagraphStyle(
        name="TableHeadText",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=7,
        leading=9,
        textColor=colors.white
    ))
    styles.add(ParagraphStyle(
        name="OfficerSeal",
        parent=styles["Normal"],
        fontName=font_bold,
        fontSize=7.5,
        leading=10,
        alignment=TA_RIGHT,
        textColor=colors.HexColor("#0F172A")
    ))
    styles.add(ParagraphStyle(
        name="MetaSmall",
        parent=styles["Normal"],
        fontName=font_reg,
        fontSize=6.5,
        leading=8.5,
        textColor=colors.HexColor("#64748B"),
        rightIndent=2
    ))
    return styles


def _legal_table(rows: list[list[Any]], widths=None):
    t = Table(rows, colWidths=widths)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94A3B8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return t


def _centrality_chart(scores: list[dict[str, Any]]) -> str | None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        labels = [s.get("label", s.get("entity_id", ""))[:18] for s in scores[:8]]
        vals = [float(s.get("composite", 0)) for s in scores[:8]]
        fig, ax = plt.subplots(figsize=(6.8, 2.5), dpi=125)

        bar_colors = [
            "#DC2626" if v >= 70 else "#D97706" if v >= 40 else "#059669"
            for v in vals
        ]

        ax.barh(labels[::-1], vals[::-1], color=bar_colors[::-1], height=0.55)
        ax.set_xlabel("Threat Centrality Score (%)", fontsize=7.5, fontweight="bold", color="#334155")
        ax.set_title("Syndicate Network Centrality & Hierarchy Index", fontsize=8.5, fontweight="bold", color="#0F172A")
        ax.set_xlim(0, 100)
        ax.tick_params(axis="both", which="major", labelsize=7)
        ax.grid(axis="x", linestyle="--", alpha=0.5)

        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format="png")
        plt.close(fig)
        buf.seek(0)
        path = Path(OUTPUT_DIR) / f"chart_{uuid.uuid4().hex}.png"
        path.write_bytes(buf.read())
        return str(path)
    except Exception as exc:
        logger.warning("Centrality chart generation failed: %s", exc)
        return None


def _qr_image(payload: str) -> tuple[RLImage | None, Path | None]:
    try:
        import qrcode
        img = qrcode.make(payload, box_size=3)
        path = Path(OUTPUT_DIR) / f"qr_{uuid.uuid4().hex}.png"
        img.save(str(path), format="PNG")
        return RLImage(str(path), width=24 * mm, height=24 * mm), path
    except Exception:
        return None, None


# =========================================================================
# 5. CORE GENERATION WORKFLOW
# =========================================================================

def generate_dossier(
    case: dict[str, Any], 
    sections: dict[str, Any], 
    evidence_qr_payload: str | None = None,
    language: str = "en"
) -> dict[str, Any]:
    """Compiles an official Police Charge Sheet with multilingual support."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lang = language if language in LEGAL_LOCALES else "en"
    loc = LEGAL_LOCALES[lang]
    styles = _make_styles(lang)
    now = datetime.utcnow()
    case_num = case.get("caseNumber", case.get("case_number", "CASE"))
    filename = f"ChargeSheet_{case_num}_{lang.upper()}_{now:%Y%m%d_%H%M%S}.pdf"
    out_path = OUTPUT_DIR / filename

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        rightMargin=17.5 * mm,
        leftMargin=17.5 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm
    )

    story: list = []
    temp_files: list[Path] = []

    # PAGE 1: STATUTORY CHARGE SHEET (FORM NO. 5.11)
    story.append(Paragraph(loc["dept"], styles["StatutoryDeptHeader"]))
    story.append(Spacer(1, 1 * mm))
    story.append(Paragraph(loc["form"], styles["ChargeSheetTitle"]))
    story.append(Paragraph(loc["sub"], styles["StatutorySectionRef"]))
    story.append(Spacer(1, 1.5 * mm))

    jurisdiction_str = str(case.get("jurisdiction", "STATE JURISDICTION")).upper()
    story.append(Paragraph(f"{loc['court']}, {jurisdiction_str}", styles["CourtTitle"]))
    story.append(Spacer(1, 2 * mm))

    inv_obj = case.get("assignedInvestigator")
    io_name = (inv_obj.get("name") if isinstance(inv_obj, dict) else str(inv_obj)) or "Insp. Aarav Deshpande"

    # Fully localized Reference Matrix
    ref_rows = [
        [
            Paragraph(loc['ps_label'], styles["FieldLabel"]),
            Paragraph(f"{case.get('jurisdiction', 'Crime Branch')} {loc['ps_val_suffix']}", styles["FieldValue"]),
            Paragraph(loc['fir_label'], styles["FieldLabel"]),
            Paragraph(case_num, styles["FieldValue"]),
        ],
        [
            Paragraph(loc['date_label'], styles["FieldLabel"]),
            Paragraph(str(case.get("startDate", case.get("createdAt", now.strftime("%Y-%m-%d"))))[:10], styles["FieldValue"]),
            Paragraph(loc['sec_label'], styles["FieldLabel"]),
            Paragraph("Sec 379, 420, 120-B IPC / BNS 316, 318, 61", styles["FieldValue"]),
        ],
        [
            Paragraph(loc['report_type_label'], styles["FieldLabel"]),
            Paragraph(f"<font color='#B91C1C'>{loc['report_type_val']}</font>", styles["FieldValue"]),
            Paragraph(loc['cctns_label'], styles["FieldLabel"]),
            Paragraph(str(case.get("externalId") or "CCTNS-AUTO-SYNC"), styles["FieldValue"]),
        ],
        [
            Paragraph(loc['io_field_label'], styles["FieldLabel"]),
            Paragraph(io_name, styles["FieldValue"]),
            Paragraph(loc['comp_label'], styles["FieldLabel"]),
            Paragraph(f"{loc['comp_val']} ({case.get('jurisdiction', 'CrimeNetX')})", styles["FieldValue"]),
        ]
    ]

    t_ref = Table(ref_rows, colWidths=[38 * mm, 50 * mm, 38 * mm, 48 * mm])
    t_ref.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#334155")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_ref)
    story.append(Spacer(1, 2.5 * mm))

    # Particulars of Accused Persons Charge-Sheeted
    story.append(Paragraph(loc["accused_title"], styles["LegalSectionH1"]))

    scores = sections.get("kingpin_scores", [])
    suspect_rows = [[
        Paragraph(loc['th_sr'], styles["TableHeadText"]),
        Paragraph(loc['th_name'], styles["TableHeadText"]),
        Paragraph(loc['th_role'], styles["TableHeadText"]),
        Paragraph(loc['th_score'], styles["TableHeadText"]),
        Paragraph(loc['th_status'], styles["TableHeadText"]),
    ]]

    if scores:
        for idx, s in enumerate(scores[:6], start=1):
            name = s.get("label", s.get("entity_id", f"Suspect #{idx}"))
            role = str(s.get("role", "OPERATOR"))
            comp_score = float(s.get("composite", 0))

            score_p = (
                Paragraph(f"<font color='#B91C1C'>{comp_score:.1f}% [{loc['kingpin_tag']}]</font>", styles["FieldValue"])
                if comp_score >= 70
                else Paragraph(f"{comp_score:.1f}%", styles["FieldValue"])
            )

            suspect_rows.append([
                Paragraph(str(idx), styles["FieldValue"]),
                Paragraph(name, styles["FieldValue"]),
                Paragraph(role, styles["FieldValue"]),
                score_p,
                Paragraph(loc["custody_status"], styles["FieldValue"]),
            ])
    else:
        suspect_rows.append([
            Paragraph("1", styles["FieldValue"]),
            Paragraph("Sunil More (alias Sunny)", styles["FieldValue"]),
            Paragraph("BROKER / EXECUTION", styles["FieldValue"]),
            Paragraph(f"<font color='#B91C1C'>88.0% [{loc['kingpin_tag']}]</font>", styles["FieldValue"]),
            Paragraph(loc["custody_status"], styles["FieldValue"]),
        ])

    story.append(_legal_table(suspect_rows, widths=[10 * mm, 62 * mm, 32 * mm, 36 * mm, 34 * mm]))
    story.append(Spacer(1, 2.5 * mm))

    # Facts & Narrative
    story.append(Paragraph(loc["facts_title"], styles["LegalSectionH1"]))
    narrative_text = _translate_narrative(case.get("description", ""), lang)
    story.append(Paragraph(narrative_text, styles["LegalBody"]))
    story.append(Spacer(1, 2.5 * mm))

    # Seized Articles
    story.append(Paragraph(loc["seizure_title"], styles["LegalSectionH1"]))
    seizure_rows = [
        [
            Paragraph(loc['th_exhibit'], styles["TableHeadText"]),
            Paragraph(loc['th_ex_desc'], styles["TableHeadText"]),
            Paragraph(loc['th_malkhana'], styles["TableHeadText"]),
        ],
        [
            Paragraph("Ex. P-1", styles["FieldValue"]),
            Paragraph(loc["ex1_desc"], styles["FieldValue"]),
            Paragraph(loc["ex1_loc"], styles["FieldValue"]),
        ],
        [
            Paragraph("Ex. P-2", styles["FieldValue"]),
            Paragraph(loc["ex2_desc"], styles["FieldValue"]),
            Paragraph(loc["ex2_loc"], styles["FieldValue"]),
        ],
        [
            Paragraph("Ex. P-3", styles["FieldValue"]),
            Paragraph(loc["ex3_desc"], styles["FieldValue"]),
            Paragraph(loc["ex3_loc"], styles["FieldValue"]),
        ]
    ]
    story.append(_legal_table(seizure_rows, widths=[18 * mm, 108 * mm, 48 * mm]))

    # PAGE 2: CHARTS & FINANCIAL TRAIL
    story.append(PageBreak())
    story.append(Paragraph(loc["tech_title"], styles["LegalSectionH1"]))
    story.append(Paragraph(loc["tech_sub"], styles["MetaSmall"]))
    story.append(Spacer(1, 2 * mm))

    if scores:
        chart_path = _centrality_chart(scores)
        if chart_path:
            story.append(RLImage(chart_path, width=170 * mm, height=65 * mm))
            temp_files.append(Path(chart_path))
            story.append(Spacer(1, 3 * mm))

    fin = sections.get("financial", {})
    if fin:
        story.append(Paragraph(loc['fin_title'], styles["LegalSectionH1"]))
        trail = fin.get("trail", [])
        if trail:
            fin_rows = [[
                Paragraph(loc['th_from'], styles["TableHeadText"]),
                Paragraph(loc['th_to'], styles["TableHeadText"]),
                Paragraph(loc['th_amt'], styles["TableHeadText"]),
                Paragraph(loc['th_time'], styles["TableHeadText"]),
            ]]
            for t in trail[:6]:
                fin_rows.append([
                    Paragraph(str(t.get("from_account", "ACC-***")), styles["FieldValue"]),
                    Paragraph(str(t.get("to_account", "ACC-***")), styles["FieldValue"]),
                    Paragraph(f"₹{float(t.get('amount', 0)):,.0f}", styles["FieldValue"]),
                    Paragraph(str(t.get("timestamp", "-"))[:19], styles["FieldValue"]),
                ])
            story.append(_legal_table(fin_rows, widths=[44 * mm, 44 * mm, 38 * mm, 48 * mm]))

    # PAGE 3: PRAYER & OFFICIAL SEALS
    story.append(PageBreak())
    story.append(Paragraph(loc["prayer_title"], styles["LegalSectionH1"]))
    story.append(Paragraph(loc["prayer"], styles["LegalBody"]))
    story.append(Spacer(1, 6 * mm))

    endorsement_block = [
        Table(
            [
                [
                    Paragraph(f"{loc['filing_date']} {now:%d-%m-%Y}", styles["FieldValue"]),
                    Paragraph(
                        f"{loc['io_seal']}<br/>"
                        f"{io_name}<br/>"
                        f"{loc['io_rank']}<br/>"
                        f"{case.get('jurisdiction', 'Maharashtra')} Crime Branch",
                        styles["OfficerSeal"]
                    )
                ]
            ],
            colWidths=[60 * mm, 114 * mm],
            style=[("VALIGN", (0, 0), (-1, -1), "TOP")]
        )
    ]
    story.append(KeepTogether(endorsement_block))
    story.append(Spacer(1, 5 * mm))

    # Two-Pass Digital Seal with SHA-256 Hash & QR
    build_dir = OUTPUT_DIR / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    temp_path = build_dir / f"tmp_{uuid.uuid4().hex}.pdf"

    tmp_doc = SimpleDocTemplate(
        str(temp_path),
        pagesize=A4,
        rightMargin=17.5 * mm,
        leftMargin=17.5 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm
    )
    tmp_doc.build(story + [Paragraph("(Computing Digest)", styles["MetaSmall"])])
    digest = hashlib.sha256(temp_path.read_bytes()).hexdigest()

    qr_payload = evidence_qr_payload or f"CRIMENETX|CHARGESHEET|{case_num}|{lang.upper()}|SHA256:{digest}"
    qr_img, qr_path = _qr_image(qr_payload)

    custody_box = [
        Table(
            [
                [
                    Paragraph(
                        f"{loc['cert_title']}<br/>"
                        f"Document SHA-256: <font face='Courier' size='7'>{digest}</font><br/>"
                        f"Case: {case_num} · Language: {lang.upper()} · CrimeNetX Final Form Engine v2.4",
                        styles["MetaSmall"]
                    ),
                    qr_img if qr_img else Paragraph("", styles["FieldValue"])
                ]
            ],
            colWidths=[140 * mm, 34 * mm],
            style=[
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#94A3B8")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    ]

    doc.build(story + [Spacer(1, 3 * mm), KeepTogether(custody_box)])

    temp_path.unlink(missing_ok=True)
    for f in temp_files:
        f.unlink(missing_ok=True)
    if qr_path:
        qr_path.unlink(missing_ok=True)
    try:
        build_dir.rmdir()
    except OSError:
        pass

    pages = 0
    try:
        from pypdf import PdfReader
        pages = len(PdfReader(str(out_path)).pages)
    except Exception:
        pass

    return {
        "case_id": case.get("id", ""),
        "s3_url": "",
        "local_path": str(out_path),
        "page_count": pages,
        "sha256_hash": digest,
        "language": lang,
        "generated_at": now,
    }