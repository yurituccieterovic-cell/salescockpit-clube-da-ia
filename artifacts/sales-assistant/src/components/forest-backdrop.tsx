export function ForestBackdrop() {
  const base = import.meta.env.BASE_URL || "/";
  const src = `${base}bg/praca-reflorestada.jpg`.replace(/\/+/g, "/");
  return (
    <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none">
      <img
        src={src}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        loading="eager"
      />
      <div className="absolute inset-0 bg-background/85 backdrop-blur-[2px]" />
    </div>
  );
}
