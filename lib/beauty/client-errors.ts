export function bookingFailureMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "網絡連線中斷，暫時無法確認預約是否送達。請保留資料並重試；相同資料重試不會重複建立要求。";
  }
  return error instanceof Error ? error.message : "暫時無法確認預約是否送達，請保留資料並稍後重試。";
}
