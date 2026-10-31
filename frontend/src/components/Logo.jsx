/** Brand mark (public/logo.svg) with the wordmark next to it. */
export default function Logo({ size = 32, wordmark = true }) {
  return (
    <span className="brand">
      <img src="/logo.svg" width={size} height={size} alt="" className="brand-logo" />
      {wordmark && (
        <span className="brand-name">
          SmartTransit <b>Bakı</b>
        </span>
      )}
    </span>
  );
}
