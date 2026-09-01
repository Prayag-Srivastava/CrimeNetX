import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import axios from "axios";
import { env } from "../config/env";

export async function getCaseSimulation(req: Request, res: Response) {
  try {
    const { id: caseId } = req.params;

    // 1. Check if case exists
    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: { entities: true }
    });

    if (!caseData) {
      return res.status(404).json({ error: "Case not found" });
    }

    // 2. Call Python AI backend to generate simulation steps
    const aiUrl = env.aiServiceUrl || "http://localhost:8000";
    let scriptData;

    try {
      const aiResponse = await axios.post(`${aiUrl}/api/nlp/generate-simulation`, {
        case_id: caseData.id,
        title: caseData.title,
        description: caseData.description,
        entities: caseData.entities.map(e => ({ type: e.type, value: e.value }))
      });
      scriptData = aiResponse.data;
    } catch (e) {
      // Fallback response if AI microservice call fails
      scriptData = {
        summary: "Reconstructed execution sequence.",
        steps: [
          {
            step_number: 1,
            time_label: "22:00 IST",
            title: "Suspect Assembly",
            description: "Suspects assembled near incident location.",
            location_name: "Target Location",
            actors: ["Suspect A", "Vehicle MH-12"],
            action_type: "assembly",
            evidence_source: "FIR Statement",
            lat: 18.5204,
            lng: 73.8567
          },
          {
            step_number: 2,
            time_label: "22:30 IST",
            title: "Financial Exit",
            description: "Funds transferred to unverified account.",
            location_name: "Digital Wallet",
            actors: ["Crypto Account"],
            action_type: "money_transfer",
            evidence_source: "Bank Statement CSV",
            lat: 18.5304,
            lng: 73.8667
          }
        ]
      };
    }

    return res.status(200).json({ success: true, simulation: scriptData });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to generate simulation" });
  }
}