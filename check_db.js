
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDuplicates() {
    try {
        console.log("--- 중복 피킹 데이터 확인 시작 ---");
        // 최근 데이터 중 기사별, 품목별로 그룹지어 2건 이상인 경우를 찾아봅니다.
        const duplicates = await prisma.$queryRaw`
            SELECT B_DATE, CB_DRIVER, B_P_NO, COUNT(*) as row_count 
            FROM t_balju 
            WHERE B_DATE >= '2026-02-01' 
            GROUP BY B_DATE, CB_DRIVER, B_P_NO 
            HAVING row_count > 1 
            LIMIT 20
        `;

        if (duplicates.length === 0) {
            console.log("SQL 상으로는 완벽하게 중복(날짜+배차+품목)된 행이 없습니다.");
        } else {
            console.log(`실제 중복 사례 ${duplicates.length}건 발견:`);
            duplicates.forEach(d => {
                console.log(`날짜: ${d.B_DATE}, 배차명: ${d.CB_DRIVER}, 품목번호: [${d.B_P_NO}], 라인수: ${d.row_count}`);
            });
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkDuplicates();
