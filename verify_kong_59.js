
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyFinalKong() {
    try {
        console.log("=== '하(바른)' 콩나물 59건 정밀 해부 ===");
        const date = '2026-02-06';

        // 1. 현재 59건이 나오는 쿼리 상황 재연
        const currentRows = await prisma.$queryRaw`
            SELECT B_P_NO, COUNT(*) as row_count
            FROM t_balju 
            WHERE B_DATE = ${date}
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하(바른)%'
            GROUP BY B_P_NO, B_C_NAME -- 거래처별로 쪼개져 있어서 줄 수가 많을 것임
        `;
        console.log(`- 현재 거래처별/품목별로 쪼개진 총 줄 수: ${currentRows.length} 건`);

        // 2. 최팀장님이 말씀하신 '진짜' 중복 제거 (거래처 상관없이 품목만 같으면 하나!)
        const realUniquePicks = await prisma.$queryRaw`
            SELECT B_P_NO, SUM(B_QTY) as total_qty
            FROM t_balju 
            WHERE B_DATE = ${date}
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하(바른)%'
            GROUP BY B_P_NO -- 거래처를 빼고 품목으로만 묶음
        `;
        console.log(`- [정답] 품목으로만 묶었을 때의 진짜 피킹 건수: ${realUniquePicks.length} 건`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyFinalKong();
