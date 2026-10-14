'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>Something didn’t load.</h1>
      <p>Your brokerage accounts are unaffected. Please try loading this workspace again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
