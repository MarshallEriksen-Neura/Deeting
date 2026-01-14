export type CursorPage<T> = {
  items: T[]
  next_page: string | null
  previous_page: string | null
}
