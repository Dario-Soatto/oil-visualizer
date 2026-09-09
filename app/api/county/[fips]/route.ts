import { NextResponse } from "next/server";
import { countyHistory } from "@/lib/db";

/** Price history for one county, fetched when a county is selected on the map. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fips: string }> },
) {
  const { fips } = await params;
  if (!/^\d{5}$/.test(fips)) {
    return NextResponse.json({ error: "bad fips" }, { status: 400 });
  }
  try {
    const points = await countyHistory(fips);
    return NextResponse.json(
      { fips, points },
      { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
