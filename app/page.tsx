/**
 * Bootstrap landing page.
 *
 * Intentionally minimal: it proves the app builds, renders and styles. The
 * Bazaar world — city, areas, merchants, simulation — is built in later
 * vertical slices, so "Enter Bazaar" has nothing to open yet.
 */

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-xl text-center">
        <h1 className="font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
          PAYTM BAZAAR
        </h1>

        <p className="mt-4 text-lg text-[#00b9f1]">
          Bazaar Se Seekho. Business Badhao.
        </p>

        <p className="mt-8 text-balance text-base opacity-80">
          The power of many, for every merchant.
        </p>

        <p className="mt-2 text-balance text-base opacity-60">
          A merchant-to-merchant intelligence ecosystem.
        </p>

        <div className="mt-12">
          <button
            type="button"
            disabled
            className="rounded-full border border-current px-8 py-3 text-sm font-medium opacity-40"
          >
            Enter Bazaar
          </button>
          <p className="mt-3 text-xs opacity-50">
            The Bazaar opens with the first vertical slice.
          </p>
        </div>
      </div>
    </main>
  );
}
