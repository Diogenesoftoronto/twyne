// Reduced from 633726a2^:src/components/onboarding/anti-tabula-rasa.tsx.
// Delayed strength updates changed props on this plain JSX layout and replaced
// the focused field. Keep the imported wrapper and JSX-valued leaf prop.
import { DossierFolio } from "./dossier-folio";
export const before = (strength: number) => (
  <DossierFolio strength={strength} leaf={<input value="draft" />} />
);
