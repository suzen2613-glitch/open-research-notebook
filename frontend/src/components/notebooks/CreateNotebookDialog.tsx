'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useCreateNotebook } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  NOTEBOOK_THEME_OPTIONS,
  NOTEBOOK_TYPE_OPTIONS,
  getNotebookThemeClasses,
  getNotebookThemeLabel,
  getNotebookTypeLabel,
} from '@/lib/notebook-appearance'
import { cn } from '@/lib/utils'

const createNotebookSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  notebook_type: z.enum(['academic', 'general']),
  theme_color: z.enum(['slate', 'blue', 'emerald', 'amber', 'rose', 'violet']),
})

type CreateNotebookFormData = z.infer<typeof createNotebookSchema>

interface CreateNotebookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateNotebookDialog({ open, onOpenChange }: CreateNotebookDialogProps) {
  const { t, language } = useTranslation()
  const createNotebook = useCreateNotebook()
  const isZh = language?.startsWith('zh')
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
    reset,
  } = useForm<CreateNotebookFormData>({
    resolver: zodResolver(createNotebookSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
      notebook_type: 'academic',
      theme_color: 'blue',
    },
  })

  const notebookType = watch('notebook_type')
  const themeColor = watch('theme_color')

  const closeDialog = () => onOpenChange(false)

  const onSubmit = async (data: CreateNotebookFormData) => {
    await createNotebook.mutateAsync(data)
    closeDialog()
    reset()
  }

  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t.notebooks.createNew}</DialogTitle>
          <DialogDescription>{t.notebooks.createNewDesc}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">{t.common.name} *</Label>
            <Input
              id="notebook-name"
              {...register('name')}
              placeholder={t.notebooks.namePlaceholder}
              autoComplete="off"
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">{t.common.description}</Label>
            <Textarea
              id="notebook-description"
              {...register('description')}
              placeholder={t.notebooks.descPlaceholder}
              rows={4}
            />
          </div>

          <div className="space-y-3">
            <Label>{isZh ? '笔记本类型' : 'Notebook type'}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {NOTEBOOK_TYPE_OPTIONS.map((type) => {
                const selected = notebookType === type
                const typeTitle = getNotebookTypeLabel(type, language)
                const typeDescription = type === 'academic'
                  ? (isZh ? '适合论文、来源、总结和 Wiki 卡片的四栏研究工作流。' : 'Four-column workflow for sources, summaries, wiki cards, and research notes.')
                  : (isZh ? '更轻量的日常记录型笔记本，只保留 Notes 一栏。' : 'A lighter notebook focused on plain notes only.')
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setValue('notebook_type', type, { shouldDirty: true, shouldValidate: true })}
                    className={cn(
                      'rounded-xl border p-4 text-left transition-colors',
                      selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40 hover:bg-muted/40'
                    )}
                  >
                    <div className="font-medium">{typeTitle}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{typeDescription}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label>{isZh ? '主题颜色' : 'Theme color'}</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {NOTEBOOK_THEME_OPTIONS.map((color) => {
                const theme = getNotebookThemeClasses(color)
                const selected = themeColor === color
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setValue('theme_color', color, { shouldDirty: true, shouldValidate: true })}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                      theme.button,
                      selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'ring-0'
                    )}
                  >
                    <span className={cn('h-3.5 w-3.5 rounded-full', theme.accent)} />
                    <span className="text-sm font-medium">{getNotebookThemeLabel(color, language)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!isValid || createNotebook.isPending}>
              {createNotebook.isPending ? t.common.creating : t.notebooks.createNew}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
