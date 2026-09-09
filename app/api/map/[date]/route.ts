import { NextResponse } from "next/server";
import { pricesOn } from "@/lib/db";

/** Every county's price on one date. Geometry is already in the page, so only
 *  the numbers travel — about 60 KB against the map's 1.2 MB of paths. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  try {
    const { fips, price } = await pricesOn(date);
    return NextResponse.json(
      { date, fips, price },
      { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
