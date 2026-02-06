
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function runDirectQuery() {
    try {
        console.log("=== [하(바른)] 콩나물 피킹 건수 직접 검증 ===");

        // 1. 순수 라인 수 (59건이 나오는지 확인)
        const rawCount = await prisma.$queryRaw`
            SELECT COUNT(*) as cnt 
            FROM t_balju 
            WHERE B_DATE = '2026-02-06'
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하(바른)%'
        `;
        console.log(`1. 2/6일자 전체 주문 라인 수: ${Number(rawCount[0].cnt)}건`);

        // 2. 최팀장님이 원하시는 중복 제거된 건수
        const dedupCount = await prisma.$queryRaw`
            SELECT COUNT(DISTINCT B_DATE, CB_DRIVER, B_P_NO) as cnt
            FROM t_balju 
            WHERE B_DATE = '2026-02-06'
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하(바른)%'
        `;
        console.log(`2. 날짜+배차명+품목코드 기준 중복 제거 건수: ${Number(dedupCount[0].cnt)}건`);

        // 3. 만약 2번이 여전히 높다면, 원인을 알기 위해 상세 내역 출력
        const rows = await prisma.$queryRaw`
            SELECT CB_DRIVER, B_P_NO, COUNT(*) as line_count
            FROM t_balju 
            WHERE B_DATE = '2026-02-06'
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하(바른)%'
            GROUP BY CB_DRIVER, B_P_NO
            LIMIT 10
        `;
        console.log("\n--- 중복된 품목 상세 (상위 10개) ---");
        rows.forEach(r => {
            console.log(`배차명: "${fixEncoding(r.CB_DRIVER)}", 품목번호: ${r.B_P_NO}, 겹친줄수: ${r.line_count}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

runDirectQuery();
