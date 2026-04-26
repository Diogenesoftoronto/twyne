export interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  description: string;
  focus: string;
}

export interface PersonaFeedback {
  personaId: string;
  personaName: string;
  personaColor: string;
  feedback: string;
  paragraphIndex?: number;
  timestamp: number;
  type: "encouragement" | "suggestion" | "critique" | "perspective";
}

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  feedback: string;
}

export interface RubricResult {
  criteria: RubricCriterion[];
  overallScore: number;
  overallGrade: string;
  summary: string;
  timestamp: number;
}

export interface Comment {
  id: string;
  text: string;
  selectedText: string;
  from: number;
  to: number;
  author: string;
  timestamp: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  text: string;
  author: string;
  timestamp: number;
}

export interface DetectedCitation {
  id: string;
  text: string;
  from: number;
  to: number;
  type: "url" | "doi" | "isbn" | "author-year" | "footnote";
  lookupUrl?: string;
  metadata?: Record<string, string>;
}

export interface DroppedAsset {
  type: "image" | "table" | "plot";
  data: string;
  position: number;
  caption?: string;
  metadata?: Record<string, string>;
}

export interface DocumentMeta {
  title: string;
  wordCount: number;
  characterCount: number;
  readingTime: number;
  lastEdited: number;
}

export interface ProjectInterviewAnswers {
  workingTitle: string;
  format: string;
  audience: string;
  goal: string;
  tone: string;
  constraints: string;
  successSignal: string;
}

export interface ProjectBrief {
  answers: ProjectInterviewAnswers;
  completedAt: number;
  updatedAt: number;
}
