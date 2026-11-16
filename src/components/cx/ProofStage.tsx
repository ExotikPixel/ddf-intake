// Light "studio" stage for one proof. With floor=true and view='floor' the image
// tilts into a perspective "on the floor" preview (CSS 3D, .floor[data-view=floor]).
export function ProofStage({ src, href, alt, floor, view, note }: {
  src?: string; href?: string; alt: string; floor: boolean; view: 'floor' | 'flat'; note?: string
}) {
  return (
    <div className="stage">
      <a className="floor" data-view={floor ? view : 'flat'} href={href ?? src} target="_blank" rel="noopener noreferrer"
        style={{ width: floor ? undefined : 'min(70%, 440px)' }} aria-label={`${alt} (opens full size)`}>
        {src
          ? <img src={src} alt={alt} />
          : <span className="small muted" style={{ display: 'grid', placeItems: 'center', aspectRatio: '1', background: '#fff', borderRadius: 6 }}>Loading proof…</span>}
      </a>
      {note && <span className="stage-note muted">{note}</span>}
    </div>
  )
}
