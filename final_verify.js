
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyFinalLogic() {
    try {
        console.log("=== [최팀장님 제안] 전표 기반 피킹 건수 검증 ===");
        const date = '2026-02-06';

        // 1. 먼저 각 배차(CB_DRIVER)와 품목(B_P_NO)의 고유한 조합을 리스트로 뽑습니다.
        // 이것이 바로 최팀장님이 말씀하신 '전표상의 줄 수'와 같습니다.
        const uniqueLines = await prisma.$queryRaw`
            SELECT CB_DRIVER, B_P_NO, SUM(B_QTY) as total_qty
            FROM t_balju 
            WHERE B_DATE = ${date}
            AND CB_DRIVER IS NOT NULL AND CB_DRIVER <> ''
            GROUP BY CB_DRIVER, B_P_NO
        `;

        console.log(`[분석 결과]`);
        console.log(`- 대상 날짜: ${date}`);
        console.log(`- 중복 제거된 총 피킹 품목 수(줄 수): ${uniqueLines.length} 줄`);

        // 2. 특정 배차(예: 하(바른))의 사례를 봅니다.
        const haBarLines = uniqueLines.filter(line => fixEncoding(line.CB_DRIVER).includes("하(바른)"));
        console.log(`- '하(바른)' 기사의 피킹 품목 수: ${haBarLines.length} 줄`);

        if (haBarLines.length > 0) {
            console.log("\n--- '하(바른)' 기사의 피킹 리스트 샘플 ---");
            haBarLines.slice(0, 10).forEach((l, i) => {
                console.log(`[${i + 1}] 품목번호: ${l.B_P_NO}, 총수량: ${l.total_qty}`);
            });
        }

        // 3. 만약 하바른 기사의 줄 수가 여전히 140줄이 넘는다면, 
        // 무엇이 이들을 서로 다르게 인식하게 하는지(예: 인코딩 등)를 파악할 수 있는 단서가 됩니다.

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyFinalLogic();
