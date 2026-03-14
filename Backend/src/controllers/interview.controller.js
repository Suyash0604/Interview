// `pdf-parse` can export differently depending on version/packaging; the
// safest approach is to keep a reference to the module and then use the
// constructor it provides.  Older code used `new pdfParse.PDFParse(...)
//`, which is still valid, so we'll preserve that pattern rather than
// assuming the package itself is a callable function.
const pdfParse = require("pdf-parse")
const { generateInterviewReport, generateResumePdf } = require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")




/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
async function generateInterViewReportController(req, res) {
    // multer should have populated `req.file` when the client uploads a
    // file with the field name `resume` (see routes/interview.routes.js).
    // If for some reason the request is malformed or the file is missing we
    // want to return a clear error instead of blowing up with a TypeError
    // when attempting to access `req.file.buffer`.

    if (!req.file) {
        return res.status(400).json({ message: "Resume file (field 'resume') is required" });
    }

    // log basic file info for debugging – helps verify that the frontend is
    // sending what we expect and can surface size/mimetype issues quickly.
    console.log("received resume file", {
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
    });

    // multer stores the original mime type.  We only support PDF uploads at
    // the moment because `pdf-parse` cannot read other document formats.  The
    // frontend currently allows `.docx` too, but if the user actually sends one
    // we'll return a clearer error rather than attempting to parse and hitting
    // the generic "Unable to read resume PDF" message.
    if (req.file.mimetype !== "application/pdf") {
        return res.status(415).json({ message: "Only PDF resumes are supported" });
    }

    const { selfDescription, jobDescription } = req.body

    // pdf-parse accepts a Buffer or Uint8Array. the existing code used the
    // lower‑level PDFParse constructor but we can simplify by calling the
    // exported function directly; this also avoids confusion when the
    // library API changes.

    let resumeContent;
    try {
        // older versions of pdf-parse (and the module itself when imported via
        // CommonJS) expose a `PDFParse` constructor rather than being a
        // callable function.  To handle both shapes we check for the presence
        // of the constructor and fall back to calling the module directly if
        // it is a function.

        if (typeof pdfParse === "function") {
            resumeContent = await pdfParse(req.file.buffer);
        } else if (pdfParse && typeof pdfParse.PDFParse === "function") {
            resumeContent = await (new pdfParse.PDFParse(Uint8Array.from(req.file.buffer))).getText();
        } else {
            throw new Error("unrecognized pdf-parse export");
        }
    } catch (err) {
        // if parsing fails it might be because the file was corrupted or not a
        // true PDF; log details so we can troubleshoot, but still respond with
        // a client-friendly message.
        console.error("failed to parse resume pdf", err);
        return res.status(422).json({ message: "Unable to read resume PDF" });
    }

    const interViewReportByAi = await generateInterviewReport({
        resume: resumeContent.text,
        selfDescription,
        jobDescription
    })

    const interviewReport = await interviewReportModel.create({
        user: req.user.id,
        resume: resumeContent.text,
        selfDescription,
        jobDescription,
        ...interViewReportByAi
    })

    res.status(201).json({
        message: "Interview report generated successfully.",
        interviewReport
    })

}

/**
 * @description Controller to get interview report by interviewId.
 */
async function getInterviewReportByIdController(req, res) {

    const { interviewId } = req.params

    const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    res.status(200).json({
        message: "Interview report fetched successfully.",
        interviewReport
    })
}


/** 
 * @description Controller to get all interview reports of logged in user.
 */
async function getAllInterviewReportsController(req, res) {
    const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan")

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    })
}


/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    const { interviewReportId } = req.params

    const interviewReport = await interviewReportModel.findById(interviewReportId)

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    const { resume, jobDescription, selfDescription } = interviewReport

    const pdfBuffer = await generateResumePdf({ resume, jobDescription, selfDescription })

    res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`
    })

    res.send(pdfBuffer)
}

module.exports = { generateInterViewReportController, getInterviewReportByIdController, getAllInterviewReportsController, generateResumePdfController }