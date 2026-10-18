import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function ReportDatePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const date = value ? new Date(`${value}T00:00:00`) : undefined
  return <Popover><PopoverTrigger asChild>
    <Button variant="outline" aria-label={label} className="justify-start gap-2">
      <CalendarIcon className="h-4 w-4" />{date ? format(date, 'dd.MM.yyyy') : label}
    </Button>
  </PopoverTrigger><PopoverContent align="start" className="w-auto p-0">
    <Calendar mode="single" locale={ru} selected={date} onSelect={d => onChange(d ? format(d, 'yyyy-MM-dd') : '')} disabled={{ after: new Date() }} className="pointer-events-auto" />
  </PopoverContent></Popover>
}