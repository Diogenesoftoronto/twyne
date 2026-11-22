// Minimal hook-free layout signature from dossier-folio.tsx. The imported
// function boundary is important: an untyped import cannot reveal this body.
export const DossierFolio = (props: { leaf: unknown; strength?: number }) => (
  <main>
    <section>{props.leaf}</section>
  </main>
);
