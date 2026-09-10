import { Root } from "protobufjs";

const root = Root.fromJSON({
  nested: {
    Agora: {
      nested: {
        SpeechToText: {
          nested: {
            Text: {
              fields: {
                uid: { type: "int64", id: 4 },
                time: { type: "int64", id: 6 },
                words: { rule: "repeated", type: "Word", id: 10 },
                durationMs: { type: "int32", id: 12 },
                dataType: { type: "string", id: 13 },
                trans: { rule: "repeated", type: "Translation", id: 14 },
                culture: { type: "string", id: 15 },
                textTs: { type: "int64", id: 16 },
                originalTranscript: { type: "OriginalTranscript", id: 18 },
                sentenceId: { type: "int64", id: 19 }
              }
            },
            Word: {
              fields: {
                text: { type: "string", id: 1 },
                isFinal: { type: "bool", id: 4 }
              }
            },
            Translation: {
              fields: {
                isFinal: { type: "bool", id: 1 },
                lang: { type: "string", id: 2 },
                texts: { rule: "repeated", type: "string", id: 3 }
              }
            },
            OriginalTranscript: {
              fields: {
                culture: { type: "string", id: 1 },
                words: { rule: "repeated", type: "Word", id: 2 }
              }
            }
          }
        }
      }
    }
  }
});

const textMessage = root.lookupType("Agora.SpeechToText.Text");

export type AgoraSttMessage = {
  speakerUid: string;
  text: string;
  isFinal: boolean;
  language?: string;
  sentenceId?: string;
  sourceTimeMs?: number;
  durationMs: number;
  textTimestampMs?: number;
};

export function decodeAgoraSttMessage(data: Uint8Array): AgoraSttMessage | null {
  const decoded = textMessage.decode(data);
  const value = textMessage.toObject(decoded, { longs: String, defaults: false }) as {
    uid?: string;
    time?: string;
    words?: Array<{ text?: string; isFinal?: boolean }>;
    durationMs?: number;
    dataType?: string;
    culture?: string;
    textTs?: string;
    sentenceId?: string;
  };
  if (value.dataType && value.dataType !== "transcribe") return null;
  const words = value.words ?? [];
  const text = words.map((word) => word.text ?? "").join("").trim();
  const speakerUid = String(value.uid ?? "");
  if (!speakerUid || !text) return null;
  return {
    speakerUid,
    text,
    isFinal: words.some((word) => word.isFinal === true),
    language: value.culture || undefined,
    sentenceId: value.sentenceId && value.sentenceId !== "0" ? value.sentenceId : undefined,
    sourceTimeMs: numberFromLong(value.time),
    durationMs: Math.max(0, Math.round(value.durationMs ?? 0)),
    textTimestampMs: numberFromLong(value.textTs)
  };
}

export function encodeAgoraSttMessage(value: Record<string, unknown>) {
  return textMessage.encode(textMessage.create(value)).finish();
}

function numberFromLong(value?: string) {
  if (!value || value === "0") return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}
